import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIdentity, buildStoryFromReadData } from '../skills/weread-story-publisher/scripts/prepare-story.mjs';

test('把微信读书年度秒数稳定转换为故事分钟、占比和公开分享信息', () => {
  const story = buildStoryFromReadData({
    totalReadTime: 125760,
    readLongest: [{
      readTime: 88920,
      book: { title: '历史深处的民国（全集）', cover: 'http://example.com/cover.jpg', category: '历史/文学' }
    }],
    readStat: [{ stat: '读过', counts: '9本' }],
    preferCategory: [
      { categoryTitle: '历史', readingTime: 72000, readingCount: 4 },
      { categoryTitle: '人物传记', readingTime: 30000, readingCount: 2 },
      { categoryTitle: '默认占位', readingTime: 0, readingCount: 0, val: 0 }
    ]
  }, { year: 2026, identity: { mode: 'anonymous' } });

  assert.equal(story.report.totalMinutes, 2096);
  assert.equal(story.report.topBook.minutes, 1482);
  assert.equal(story.report.focusPercent, 71);
  assert.equal(story.report.booksRead, 9);
  assert.deepEqual(story.report.topics, ['历史', '人物传记', '文学']);
  assert.equal(story.report.topBook.coverUrl, 'https://example.com/cover.jpg');
  assert.ok(story.narrative.pages.length >= 3);
  assert.ok(story.narrative.pages.some(page => page.type === 'book'));
  assert.ok(story.narrative.pages.some(page => page.type === 'topics'));
  assert.match(story.share.title, /2026 阅读故事/);
  assert.match(story.share.description, /34小时56分/);
});

test('署名方式要求与公开信息匹配', () => {
  assert.deepEqual(buildIdentity({ identity: 'anonymous' }), { mode: 'anonymous' });
  assert.deepEqual(buildIdentity({ identity: 'name', nickname: '阅读者' }), { mode: 'name', nickname: '阅读者' });
  assert.deepEqual(
    buildIdentity({ identity: 'name_avatar', nickname: '阅读者', avatarUrl: 'http://example.com/avatar.jpg' }),
    { mode: 'name_avatar', nickname: '阅读者', avatarUrl: 'https://example.com/avatar.jpg' }
  );
  assert.throws(() => buildIdentity({ identity: 'name_avatar', nickname: '阅读者' }), /头像地址缺失/);
});

test('故事页由可靠信号决定，不沿用试用原型的固定六页', () => {
  const sparse = buildStoryFromReadData({
    totalReadTime: 72_000,
    readLongest: [{ readTime: 24_000, book: { title: '甲书', cover: 'https://example.com/a.jpg' } }],
    preferCategory: []
  }, { year: 2025, identity: { mode: 'anonymous' } });
  const rich = buildStoryFromReadData({
    totalReadTime: 360_000,
    readDays: 219,
    readRate: 72,
    readLongest: [
      { readTime: 120_000, book: { title: '甲书', cover: 'https://example.com/a.jpg' } },
      { readTime: 80_000, book: { title: '乙书', cover: 'https://example.com/b.jpg' } },
      { readTime: 40_000, book: { title: '丙书', cover: 'https://example.com/c.jpg' } }
    ],
    preferCategory: [{ categoryTitle: '历史', readingTime: 240_000, readingCount: 6 }],
    preferAuthor: [{ name: '作者甲', count: 3 }],
    preferTime: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4_000, 4_000, 8_000, 30_000, 30_000, 20_000, 0, 0, 0, 0, 0, 0]
  }, { year: 2025, identity: { mode: 'anonymous' } });

  assert.ok(sparse.narrative.pages.length < rich.narrative.pages.length);
  assert.equal(sparse.narrative.pages.length, 3);
  assert.equal(sparse.narrative.pages.some(page => page.type === 'days'), false);
  assert.equal(sparse.narrative.pages.some(page => page.type === 'topics'), false);
  assert.ok(rich.narrative.pages.some(page => page.type === 'days'));
  assert.ok(rich.narrative.pages.every(page => !/历史深处|同一套书/.test(page.title + page.body)));
});
