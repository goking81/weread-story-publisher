import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..', import.meta.url);
function launch(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', data => child.output += data);
  child.stderr.on('data', data => child.output += data);
  return child;
}
async function run(args, env, code = 0) {
  const child = launch(args, env);
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, code, child.output);
  return child.output;
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await wait(50); }
  throw new Error('测试服务启动超时');
}

test('安装包脚本全流程：配置防护、真实 CLI 生成、加密发布、凭据隔离和撤销', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'weread-cli-'));
  const env = { ...process.env, WEREAD_STORY_CONFIG_DIR: directory, WEREAD_STORY_PUBLISH_URL: 'https://publisher.test' };
  delete env.WEREAD_API_KEY;
  const prefix = process.env.SKILL_TEST_DIR ? join(process.env.SKILL_TEST_DIR, 'scripts') + '/' : 'skills/weread-story-publisher/scripts/';
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(async child => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }));
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal(JSON.parse(await run([prefix + 'setup.mjs', '--status'], env)).configured, false);
  assert.match(await run([prefix + 'prepare-story.mjs', '--year', '2026'], env, 1), /尚未配置/);
  const setup = launch([prefix + 'setup.mjs'], env);
  children.push(setup);
  await until(() => /http:\/\/127\.0\.0\.1:\d+/.test(setup.output));
  const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(setup.output)[0];
  assert.equal((await fetch(origin)).status, 200);
  const configure = (headers, body = { apiKey: 'wrk-synthetic-test-only' }) => fetch(origin + '/configure', {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  assert.equal((await configure({ 'Content-Type': 'application/json', Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await configure({ 'Content-Type': 'text/plain', Origin: origin })).status, 403);
  assert.equal((await configure({ 'Content-Type': 'application/json', Origin: origin }, null)).status, 400);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    get(origin, { headers: { Host: 'attacker.test' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  const exited = once(setup, 'exit');
  assert.equal((await configure({ 'Content-Type': 'application/json', Origin: origin })).status, 200);
  await exited;
  assert.equal(JSON.parse(await run([prefix + 'setup.mjs', '--status'], env)).configured, true);
  assert.doesNotMatch(setup.output, /wrk-synthetic/);

  const port = 43000 + Math.floor(Math.random() * 5000);
  const local = 'http://127.0.0.1:' + port;
  const server = launch(['server.mjs'], { ...env, PORT: String(port), STORY_DATA_FILE: join(directory, 'store.json'),
    PUBLIC_BASE_URL: 'https://publisher.test', PUBLISH_MAX_PUBLISHES_PER_HOUR: '100' });
  children.push(server);
  await until(async () => { try { return (await fetch(local + '/health')).ok; } catch { return false; } });
  // 只替换测试子进程的外部网络，生产脚本仍按原路径运行；不使用用户真实 Key。
  const preload = join(directory, 'network.mjs');
  await writeFile(preload, `
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith('https://i.weread.qq.com/')) {
        if (process.env.QA_API_CASE === 'unauthorized') return new Response('{}', {status:401});
        if (process.env.QA_API_CASE === 'html') return new Response('<html>error</html>', {status:502});
        if (process.env.QA_API_CASE === 'upgrade') return Response.json({upgrade_info:{message:'接口要求升级'}});
        if (init.headers.Authorization !== 'Bearer wrk-synthetic-test-only') throw new Error('Key missing');
        if (JSON.parse(init.body).mode !== 'annually') throw new Error('wrong API');
        return Response.json({errcode:0,data:{totalReadTime:72000,readLongest:[{readTime:24000,book:{title:'合成测试书',cover:'https://example.com/cover.png'}}]}});
      }
      if (!String(input).startsWith('https://publisher.test')) throw new Error('unexpected network');
      if (JSON.stringify(init || {}).includes('wrk-synthetic-test-only')) throw new Error('API Key leaked');
      return original(String(input).replace('https://publisher.test', '${local}'), init);
    };
  `, 'utf8');
  const args = ['--import', pathToFileURL(preload).href];
  const payload = join(directory, '中文 报告.json');
  for (const [failure, expected] of [['unauthorized', /401/], ['html', /502/], ['upgrade', /接口要求升级/]]) {
    assert.match(await run([...args, prefix + 'prepare-story.mjs', '--year', '2026'], { ...env, QA_API_CASE: failure }, 1), expected);
  }
  await run([...args, prefix + 'prepare-story.mjs', '--year', '2026', '--identity', 'anonymous', '--output', payload], env);
  const story = JSON.parse(await readFile(payload, 'utf8'));
  assert.equal(story.narrative.pages.length, 3);
  // 数据已生成后发布与撤销不再需要读取 API Key。
  await rm(join(directory, 'credentials.json'));
  const output = await run([...args, prefix + 'publish-story.mjs', payload], { ...env, WEREAD_STORY_URL_OUTPUT: join(directory, 'story.url') });
  assert.doesNotMatch(output, /wrk-synthetic|#|credential/);
  const published = JSON.parse(output);
  const fullUrl = await readFile(published.urlFile, 'utf8');
  const key = Buffer.from(new URL(fullUrl).hash.slice(1), 'base64url');
  assert.equal(key.length, 32);
  const management = JSON.parse(await readFile(published.revokeFile, 'utf8'));
  assert.notEqual(management.credential, key.toString('base64url'));
  const api = local + '/api/stories/' + published.slug;
  const { envelope } = await (await fetch(api)).json();
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64url') }, cryptoKey, Buffer.from(envelope.ciphertext, 'base64url'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain)), story);
  assert.doesNotMatch(await readFile(join(directory, 'store.json'), 'utf8'), /wrk-synthetic|totalMinutes|合成测试书/);
  const page = await fetch(local + '/s/' + published.slug);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /2026 阅读故事 · 20小时0分/);
  assert.equal((await readFile(published.qrPath)).subarray(1, 4).toString(), 'PNG');
  assert.equal((await fetch(api, { method: 'DELETE', headers: { 'X-Story-Revoke': key.toString('base64url') } })).status, 401);
  assert.match(await run([...args, prefix + 'revoke-story.mjs', published.revokeFile], env), /已撤销/);
  assert.equal((await fetch(api)).status, 404);
  assert.equal((await fetch(local + '/s/' + published.slug)).status, 404);
  // 已上传但本地文件无法保存：必须撤回本次上传，不能留下孤立报告。
  const failedOutput = await run([...args, prefix + 'publish-story.mjs', payload],
    { ...env, WEREAD_STORY_URL_OUTPUT: join(directory, '不存在的目录', 'story.url') }, 1);
  assert.match(failedOutput, /本次发布已撤销/);
  assert.equal(JSON.parse(await readFile(join(directory, 'store.json'), 'utf8')).stories.length, 0);
});
