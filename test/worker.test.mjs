import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { randomBytes, createHash } from 'node:crypto';

test('Worker 实际运行时：加密存储、TTL、输入边界、限流及独立撤销权限', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    modules: true, scriptPath: 'src/worker.js', compatibilityDate: '2026-09-11',
    kvNamespaces: ['WEREAD_STORIES'],
    durableObjects: { PUBLISH_RATE_LIMITER: { className: 'PublishRateLimiter', useSQLite: true } },
    bindings: { RATE_LIMIT_SALT: 'test-salt', DEFAULT_EXPIRY_DAYS: 30, PUBLISH_MAX_PUBLISHES_PER_HOUR: 5 },
    serviceBindings: { ASSETS: () => new Response('<html><head><title>默认标题</title><meta id="share-description"><meta id="share-og-title"><meta id="share-og-description"><meta id="share-og-image"><meta id="share-og-url"><meta id="share-item-name"><meta id="share-item-description"><meta id="share-item-image"><link id="share-image-src"><meta id="share-twitter-title"><meta id="share-twitter-description"><meta id="share-twitter-image"></head></html>', { headers: { 'Content-Type': 'text/html' } }) }
  }] }));
  try {
    const root = await mf.dispatchFetch('https://story.test/');
    assert.equal(root.status, 404);
    assert.doesNotMatch(await root.text(), /历史深处|34小时56分/);
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode('阅读者的私密统计'));
    const credential = randomBytes(32).toString('base64url');
    const share = { title: '2026，我一直在往历史深处走', description: '34小时56分，71%的阅读时间留给了同一套书', imageUrl: '/assets/history-deep-republic-one-hd.jpg' };
    const body = JSON.stringify({ envelope: { version: 1, iv: iv.toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') }, revokeHash: credential, share });
    const post = content => mf.dispatchFetch('https://story.test/api/stories', { method: 'POST', body: content });
    assert.equal((await post(JSON.stringify({ report: '明文' }))).status, 400);
    assert.equal((await post('a'.repeat(90001))).status, 400);
    const result = await post(body);
    assert.equal(result.status, 201);
    const published = await result.json();
    assert.ok(Math.abs(Date.parse(published.expiresAt) - Date.now() - 30 * 86400000) < 10000);
    const kv = await mf.getKVNamespace('WEREAD_STORIES');
    const stored = await kv.get(`story:${published.slug}`);
    assert.ok(!stored.includes('私密统计'));
    assert.ok(stored.includes(share.title));
    assert.ok((await kv.list()).keys[0].expiration > Date.now() / 1000);
    const apiUrl = `https://story.test/api/stories/${published.slug}`;
    const fetched = await (await mf.dispatchFetch(apiUrl)).json();
    assert.equal(fetched.revokeHash, undefined);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, Buffer.from(fetched.envelope.ciphertext, 'base64url'));
    assert.equal(new TextDecoder().decode(plain), '阅读者的私密统计');
    const html = await mf.dispatchFetch(published.url);
    const sharedPage = await html.text();
    assert.match(sharedPage, /2026，我一直在往历史深处走/);
    assert.match(sharedPage, /https:\/\/story\.test\/assets\/history-deep-republic-one-hd\.jpg/);
    assert.match(sharedPage, new RegExp(`https://story\\.test/s/${published.slug}`));
    assert.equal(html.headers.get('Referrer-Policy'), 'no-referrer');
    const viewerCredential = createHash('sha256').update(key).digest('base64url');
    assert.equal((await mf.dispatchFetch(apiUrl, { method: 'DELETE', headers: { 'X-Story-Revoke': viewerCredential } })).status, 401);
    assert.equal((await mf.dispatchFetch(apiUrl, { method: 'DELETE', headers: { 'X-Story-Revoke': credential } })).status, 204);
    assert.equal(await kv.get(`story:${published.slug}`), null);
    await post(body);
    await post(body);
    assert.equal((await post(body)).status, 429);
  } finally { await mf.dispose(); }
});
