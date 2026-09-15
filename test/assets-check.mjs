import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

// 使用 Wrangler 的真实 Assets 绑定，防止模拟资源响应漏掉 HTML 自动重定向。
const directory = await mkdtemp(join(tmpdir(), 'weread-assets-'));
const origin = 'http://127.0.0.1:46783';
const server = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--port', '46783',
  '--ip', '127.0.0.1', '--persist-to', directory, '--var', 'RATE_LIMIT_SALT:qa-test-only'],
  { stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', data => output += data);
server.stderr.on('data', data => output += data);
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(origin + '/health')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert.ok(ready, 'Wrangler 本地启动超时');
  for (const path of ['/', '/index.html', '/s/AAAAAAAAAAAAAAAAAA']) {
    assert.equal((await fetch(origin + path, { redirect: 'manual' })).status, 404);
  }
  const credential = randomBytes(32).toString('base64url');
  const published = await fetch(origin + '/api/stories', { method: 'POST', body: JSON.stringify({
    envelope: { version: 1, iv: randomBytes(12).toString('base64url'), ciphertext: randomBytes(48).toString('base64url') },
    revokeHash: credential, share: { title: '真实资源绑定回归测试', description: '仅用于本地测试', imageUrl: 'https://example.com/cover.jpg' }
  }) });
  assert.equal(published.status, 201);
  const { slug } = await published.json();
  // 自定义域名会被 Wrangler 写入请求的 Host；测试只能读取本地 KV 对应的本地 URL。
  const url = origin + '/s/' + slug;
  for (const headers of [{}, { 'If-None-Match': '"old-asset"' }]) {
    const page = await fetch(url, { headers, redirect: 'manual' });
    assert.equal(page.status, 200, JSON.stringify({ url, body: page.status === 200 ? '' : await page.text(), output }));
    assert.equal(page.headers.get('Location'), null);
    const html = await page.text();
    assert.match(html, /<title>真实资源绑定回归测试<\/title>/);
    assert.match(html, /id="share-og-image"[^>]+https:\/\/example.com\/cover.jpg/);
    assert.doesNotMatch(html, /历史深处|71%|34小时56分/);
  }
  assert.equal((await fetch(origin + '/story.js')).status, 200);
  assert.equal((await fetch(origin + '/api/stories/' + slug, { method: 'DELETE', headers: { 'X-Story-Revoke': credential } })).status, 204);
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 404);
  console.log('PASS: 真实 Wrangler Assets、200 非重定向、分享标题封面、条件缓存、无效与撤销链接 404。');
} finally {
  if (server.exitCode === null) {
    // 关闭输入让 Wrangler 正常释放本地子进程和数据库。
    const exited = once(server, 'exit');
    server.stdin.end();
    const stopped = await Promise.race([exited.then(() => true), wait(2000).then(() => false)]);
    if (!stopped) { server.kill(); await exited; }
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
