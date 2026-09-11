import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { randomBytes, createHash } from 'node:crypto';

test('Worker 实际运行时：加密存储、TTL、输入边界、限流及独立撤销权限', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    modules: true, scriptPath: 'src/worker.js', compatibilityDate: '2026-09-10',
    kvNamespaces: ['WEREAD_STORIES'],
    durableObjects: { PUBLISH_RATE_LIMITER: { className: 'PublishRateLimiter', useSQLite: true } },
    bindings: { PUBLISH_INVITE_CODES: 'test-invite', RATE_LIMIT_SALT: 'test-salt', DEFAULT_EXPIRY_DAYS: 30, PUBLISH_MAX_PUBLISHES_PER_HOUR: 5 },
    serviceBindings: { ASSETS: request => new Response(new URL(request.url).pathname) }
  }] }));
  try {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode('阅读者的私密统计'));
    const credential = randomBytes(32).toString('base64url');
    const body = JSON.stringify({ envelope: { version: 1, iv: iv.toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') }, revokeHash: credential });
    const post = (content, invite = 'test-invite') => mf.dispatchFetch('https://story.test/api/stories', { method: 'POST', headers: { 'X-Story-Invite': invite }, body: content });
    assert.equal((await post(body, 'wrong')).status, 401);
    assert.equal((await post(JSON.stringify({ report: '明文' }))).status, 400);
    assert.equal((await post('a'.repeat(90001))).status, 400);
    const result = await post(body);
    assert.equal(result.status, 201);
    const published = await result.json();
    assert.ok(Math.abs(Date.parse(published.expiresAt) - Date.now() - 30 * 86400000) < 10000);
    const kv = await mf.getKVNamespace('WEREAD_STORIES');
    const stored = await kv.get(`story:${published.slug}`);
    assert.ok(!stored.includes('私密统计'));
    assert.ok((await kv.list()).keys[0].expiration > Date.now() / 1000);
    const apiUrl = `https://story.test/api/stories/${published.slug}`;
    const fetched = await (await mf.dispatchFetch(apiUrl)).json();
    assert.equal(fetched.revokeHash, undefined);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, Buffer.from(fetched.envelope.ciphertext, 'base64url'));
    assert.equal(new TextDecoder().decode(plain), '阅读者的私密统计');
    const html = await mf.dispatchFetch(published.url);
    assert.equal(await html.text(), '/');
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
