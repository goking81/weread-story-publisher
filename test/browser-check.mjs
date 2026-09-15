import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { buildStoryFromReadData } from '../skills/weread-story-publisher/scripts/prepare-story.mjs';

// 使用可选浏览器测试环境，不把浏览器依赖塞入可移植 Skill 安装包。
const require = createRequire(process.env.BROWSER_PACKAGE_ROOT ? join(process.env.BROWSER_PACKAGE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const directory = await mkdtemp(join(tmpdir(), 'weread-browser-'));
const output = resolve('qa-artifacts');
await mkdir(output, { recursive: true });
const port = 48000 + Math.floor(Math.random() * 4000);
const origin = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port),
  STORY_DATA_FILE: join(directory, 'stories.json'), PUBLIC_BASE_URL: origin, PUBLISH_MAX_PUBLISHES_PER_HOUR: '100' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/health')).ok) break; } catch {} await wait(50); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const story = buildStoryFromReadData({
    totalReadTime: 3600000, readDays: 200, readRate: 80, readStat: [{ stat: '读过', counts: '128本' }],
    readLongest: [600000, 400000, 300000].map((readTime, index) => ({ readTime, book: {
      title: index === 0 ? '超长标题兼容测试：一个人物与一个时代的阅读记录（全集增订珍藏版本）' : '合成测试书' + index,
      cover: 'https://example.com/cover.jpg' } })),
    preferCategory: [{ categoryTitle: '历史', readingTime: 1800000 }], preferAuthor: [{ name: '测试作者', count: 8 }]
  }, { year: 2026, identity: { mode: 'name_avatar', nickname: '<script>测试读者</script>', avatarUrl: 'https://example.com/avatar.jpg' } });
  async function publish(payload) {
    const rawKey = randomBytes(32), iv = randomBytes(12);
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    const response = await fetch(origin + '/api/stories', { method: 'POST', body: JSON.stringify({
      envelope: { version: 1, iv: iv.toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') },
      revokeHash: randomBytes(32).toString('base64url'), share: payload.share
    }) });
    assert.equal(response.status, 201);
    return (await response.json()).url + '#' + rawKey.toString('base64url');
  }
  const url = await publish(story);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240"><rect width="180" height="240" fill="#c9a052"/><text x="18" y="60">TEST BOOK</text></svg>' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[320,568], [390,844], [430,932]]) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await page.waitForSelector('.dynamic-page');
    assert.equal(await page.locator('.dynamic-page').count(), story.narrative.pages.length);
    assert.equal(await page.title(), story.share.title);
    assert.equal(await page.locator('.reader-mark').innerText(), '<script>测试读者</script> 的阅读视界');
    const layout = await page.evaluate(() => [...document.querySelectorAll('.dynamic-page')].map(section => {
      const rect = section.getBoundingClientRect();
      const children = [...section.querySelectorAll('.dynamic-title,.dynamic-metric,.dynamic-copy,.dynamic-cover')];
      const overflow = children.filter(el => { const box = el.getBoundingClientRect(); return box.right > rect.right + 1 || box.left < rect.left - 1; }).length;
      const cover = section.querySelector('.dynamic-cover')?.getBoundingClientRect();
      const overlaps = cover && [...section.querySelectorAll('.dynamic-title,.dynamic-metric,.dynamic-copy')].some(el => {
        const box = el.getBoundingClientRect();
        return box.left < cover.right && box.right > cover.left && box.top < cover.bottom && box.bottom > cover.top;
      });
      return { overflow, overlaps: !!overlaps };
    }));
    assert.ok(layout.every(item => !item.overflow && !item.overlaps), JSON.stringify({ width, layout }));
    await page.locator('.dynamic-book').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, 'book-' + width + '.png') });
    await page.locator('#shareLaunch').click();
    await page.waitForSelector('#shareSheet[open]');
    assert.equal(await page.locator('#storyQr').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await page.screenshot({ path: join(output, 'share-' + width + '.png') });
    await page.getByRole('button', { name: '关闭分享面板' }).click();
  }
  const legacy = structuredClone(story); delete legacy.narrative;
  await page.goto(await publish(legacy));
  await page.waitForSelector('.dynamic-page');
  assert.equal(await page.locator('.dynamic-page').count(), 3);
  await page.goto(url.split('#')[0]);
  await page.waitForFunction(() => document.querySelector('.story-unavailable')?.textContent.includes('完整'));
  assert.equal(await page.locator('.dynamic-page').count(), 0);
  await page.goto(url.split('#')[0] + '#' + randomBytes(32).toString('base64url'));
  await page.waitForFunction(() => document.querySelector('.story-unavailable')?.textContent.includes('解密失败'));
  assert.equal(await page.locator('.dynamic-page').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(url);
  await page.waitForSelector('.dynamic-page.seen');
  assert.notEqual(await page.locator('.dynamic-page.seen .dynamic-title').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log('PASS: 320/390/430 手机宽度、7 页解密、3 页旧格式、无溢出遮挡、昵称转义、二维码、缺失/错误密钥、慢动效。');
} finally {
  await browser?.close();
  const exited = once(server, 'exit'); server.kill(); await exited;
  await rm(directory, { recursive: true, force: true });
}
