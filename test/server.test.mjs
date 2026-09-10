import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..', import.meta.url);
const port = 34000 + Math.floor(Math.random() * 8000);
const baseUrl = `http://127.0.0.1:${port}`;
const apiKey = 'test-publish-key-is-long-enough-1234';
const dataDirectory = await mkdtemp(join(tmpdir(), 'weread-story-test-'));
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: baseUrl, PUBLISH_API_KEY: apiKey, STORY_DATA_FILE: join(dataDirectory, 'stories.json') },
  stdio: 'ignore'
});

test('创建、读取、生成二维码并撤销一份故事', async (context) => {
  context.after(async () => {
    server.kill();
    await rm(dataDirectory, { recursive: true, force: true });
  });
  await waitForHealth();
  const payload = {
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
  const created = await fetch(`${baseUrl}/api/stories`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  const published = await created.json();
  assert.match(published.slug, /^[A-Za-z0-9_-]{12,}$/);

  const story = await fetch(`${baseUrl}/api/stories/${published.slug}`);
  assert.equal(story.status, 200);
  assert.equal((await story.json()).report.topBook.title, payload.report.topBook.title);

  const page = await fetch(published.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /story\.js/);
  assert.equal((await fetch(`${baseUrl}/s/story.css`)).status, 200);

  const qr = await fetch(`${baseUrl}/api/stories/${published.slug}/qr.png`);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.ok((await qr.arrayBuffer()).byteLength > 100);

  const revoked = await fetch(`${baseUrl}/api/stories/${published.slug}`, { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(revoked.status, 204);
  assert.equal((await fetch(`${baseUrl}/api/stories/${published.slug}`)).status, 404);
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch { /* 服务尚在启动。 */ }
    await wait(100);
  }
  throw new Error('测试服务器没有启动。');
}
