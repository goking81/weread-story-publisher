import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStoryFromReadData } from '../skills/weread-story-publisher/scripts/prepare-story.mjs';

const options = { year: 2026, identity: { mode: 'anonymous' } };
const book = (title, readTime, cover = 'https://example.com/cover.jpg') => ({ readTime, book: { title, cover } });

test('主书按有效时长排序，跳过损坏的可选书籍记录', () => {
  const story = buildStoryFromReadData({ totalReadTime: 10000, readLongest: [
    book('短书', 600), book('最长的书', 6000), book('坏时长', 'NaN'), book('坏图片', 400, 'javascript:alert(1)')
  ] }, options);
  assert.equal(story.report.topBook.title, '最长的书');
  assert.equal(story.report.focusPercent, 60);
  assert.deepEqual(story.report.topBooks.map(item => item.title), ['最长的书', '短书']);
});

test('千位书数与小占比不失真，单日记录不生成反复阅读结论', () => {
  const story = buildStoryFromReadData({ totalReadTime: 100000, readDays: 1,
    readLongest: [book('甲', 100)], readStat: [{ stat: '读过', counts: '1,234本' }]
  }, options);
  assert.equal(story.report.booksRead, 1234);
  assert.equal(story.report.focusPercent, 0);
  assert.equal(story.narrative.pages.some(page => page.type === 'days'), false);
});

test('年度时长矛盾不能被截断成看似正常的百分比', () => {
  assert.throws(() => buildStoryFromReadData({ totalReadTime: 60, readLongest: [book('甲', 120)] }, options), /时长/);
});

test('异常可选信号被省略，全年阅读和作者排序不产生错误结论', () => {
  const data = { totalReadTime: 10000, readLongest: [book('甲', 6000)], readDays: 500,
    preferAuthor: [{ name: '异常', count: 'Infinity' }, { name: '少读', count: 2 }, { name: '多读', count: 5 }] };
  const story = buildStoryFromReadData(data, options);
  assert.equal(story.report.readDays, null);
  assert.deepEqual(story.report.preferredAuthor, { name: '多读', count: 5 });
  const allYear = buildStoryFromReadData({ ...data, readDays: 365 }, options);
  assert.doesNotMatch(allYear.narrative.pages.find(page => page.type === 'days').body, /没有占满/);
});

test('缺失主书或全是收听记录时明确停止，不借用任何示例书', () => {
  assert.throws(() => buildStoryFromReadData({ totalReadTime: 3600, readLongest: [] }, options), /没有可用于/);
  assert.throws(() => buildStoryFromReadData({ totalReadTime: 3600, readLongest: [{ albumInfo: { title: '音频' }, readTime: 1000 }] }, options), /没有可用于/);
});
