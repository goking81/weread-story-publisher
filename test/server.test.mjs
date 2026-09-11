import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..', import.meta.url);
const port = 34000 + Math.floor(Math.random() * 8000);
const baseUrl = `http://127.0.0.1:${port}`;
const inviteCode = 'test-invite-code-is-long-enough-1234';
const dataDirectory = await mkdtemp(join(tmpdir(), 'weread-story-test-'));
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: baseUrl, PUBLISH_INVITE_CODES: inviteCode, DEFAULT_EXPIRY_DAYS: '30', STORY_DATA_FILE: join(dataDirectory, 'stories.json') },
  stdio: 'ignore'
});

test('只保存密文、浏览器可解密，并能撤销一份故事', async (context) => {
  context.after(async () => {
    server.kill();
    await rm(dataDirectory, { recursive: true, force: true });
  });
  await waitForHealth();
  const rawStory = {
    identity: { mode: 'name', nickname: '阅读者' },
    report: {
      year: 2026,
      focusPercent: 71,
      totalMinutes: 2096,
      booksRead: 9,
      topBook: { title: '历史深处的民国（全集）', minutes: 1482, coverUrl: '/assets/history-deep-republic-one-hd.jpg' },
      topics: ['历史', '人物传记', '年代小说', '文学']
    }
  };
  const { key, envelope, revokeHash } = await encryptStory(rawStory);
  const rejected = await fetch(`${baseUrl}/api/stories`, { method: 'POST', headers: { 'X-Story-Invite': 'wrong-code', 'Content-Type': 'application/json' }, body: JSON.stringify({ envelope, revokeHash }) });
  assert.equal(rejected.status, 401);

  const created = await fetch(`${baseUrl}/api/stories`, {
    method: 'POST',
    headers: { 'X-Story-Invite': inviteCode, 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelope, revokeHash })
  });
  assert.equal(created.status, 201);
  const published = await created.json();
  assert.match(published.slug, /^[A-Za-z0-9_-]{12,}$/);

  const story = await fetch(`${baseUrl}/api/stories/${published.slug}`);
  assert.equal(story.status, 200);
  const storedStory = await story.json();
  assert.deepEqual(await decryptStory(storedStory.envelope, key), rawStory);
  assert.equal(storedStory.report, undefined);
  const disk = await readFile(join(dataDirectory, 'stories.json'), 'utf8');
  assert.doesNotMatch(disk, /历史深处/);
  assert.doesNotMatch(disk, /阅读者/);

  const page = await fetch(published.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /story\.js/);
  assert.equal((await fetch(`${baseUrl}/story.css`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/qrcode.mjs`)).status, 200);

  const revoked = await fetch(`${baseUrl}/api/stories/${published.slug}`, { method: 'DELETE', headers: { 'X-Story-Revoke': revokeHash } });
  assert.equal(revoked.status, 204);
  assert.equal((await fetch(`${baseUrl}/api/stories/${published.slug}`)).status, 404);
});

async function encryptStory(story) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(story)));
  return {
    key,
    envelope: { version: 1, iv: iv.toString('base64url'), ciphertext: Buffer.from(encrypted).toString('base64url') },
    revokeHash: createHash('sha256').update(key).digest('base64url')
  };
}

async function decryptStory(envelope, key) {
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64url') },
    cryptoKey,
    Buffer.from(envelope.ciphertext, 'base64url')
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch { /* 服务尚在启动。 */ }
    await wait(100);
  }
  throw new Error('测试服务器没有启动。');
}
