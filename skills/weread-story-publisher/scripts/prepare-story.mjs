import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfiguration } from './config.mjs';

const API_URL = 'https://i.weread.qq.com/api/agent/gateway';
const WEREAD_SKILL_VERSION = '1.0.4';

export function buildStoryFromReadData(data, { year, identity, expiresInDays = 30 }) {
  const totalSeconds = positiveNumber(data.totalReadTime, 'totalReadTime');
  const rankedBooks = collectRankedBooks(data.readLongest);
  const rankedBook = rankedBooks[0];
  if (!rankedBook) throw new Error('年度统计中没有可用于主视觉的电子书及封面。');

  const booksRead = parseBooksRead(data.readStat);
  const topics = collectTopics(data.preferCategory, rankedBook.categories);
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const topBookMinutes = rankedBook.minutes;
  const focusPercent = percentage(rankedBook.seconds, totalSeconds);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const report = {
    year,
    totalMinutes,
    booksRead,
    readDays: optionalPositiveInteger(data.readDays),
    focusPercent,
    topBook: rankedBook,
    topBooks: rankedBooks.slice(0, 3),
    topics,
    categoryFocus: calculateCategoryFocus(data.preferCategory),
    preferredAuthor: selectPreferredAuthor(data.preferAuthor),
    readingRhythm: calculateReadingRhythm(data.preferTime),
    readRate: optionalPercentage(data.readRate)
  };

  return {
    identity,
    report,
    narrative: { version: 1, pages: buildNarrative(report) },
    share: {
      title: `${year} 阅读故事 · ${hours}小时${minutes}分`,
      description: `${hours}小时${minutes}分${booksRead ? ` · 读过 ${booksRead} 本` : ''}，生成一份只属于这段阅读记录的故事`,
      imageUrl: rankedBook.coverUrl
    },
    expiresInDays
  };
}

export function buildNarrative(report) {
  const candidates = [
    report.topBook && {
      type: 'book', score: .3 + report.focusPercent / 100, label: '投入最多的一本书',
      title: `《${report.topBook.title}》`,
      metric: formatDuration(report.topBook.minutes),
      body: `${report.focusPercent}% 的阅读时间，留在这里。`, coverUrl: report.topBook.coverUrl
    },
    report.readDays && {
      type: 'days', score: Math.min(.85, report.readDays / 365), label: '阅读出现的日子',
      title: `${report.readDays} 天`, metric: '有效阅读日',
      body: '阅读没有占满每一天，但它确实在这一年里反复出现。'
    },
    report.topics.length && {
      type: 'topics', score: .35 + (report.categoryFocus || 0) / 2, label: '时间落下的方向',
      title: report.topics.slice(0, 4).join(' · '), metric: '阅读主题',
      body: report.categoryFocus >= .55 ? '多数时间落在相近的主题里。' : '它们共同构成了这一年的阅读版图。', topics: report.topics.slice(0, 4)
    },
    report.readingRhythm && {
      type: 'rhythm', score: report.readingRhythm.share, label: '阅读常发生在',
      title: report.readingRhythm.label, metric: `${Math.round(report.readingRhythm.share * 100)}% 的时段集中于此`,
      body: '这是年度时段记录呈现出的重心，不是对生活方式的定义。'
    },
    report.preferredAuthor && {
      type: 'author', score: Math.min(.8, .3 + report.preferredAuthor.count / 10), label: '反复读到的作者',
      title: report.preferredAuthor.name, metric: `${report.preferredAuthor.count} 本`,
      body: '这份年度记录里，这位作者被多次读到。'
    },
    report.readRate !== null && {
      type: 'format', score: Math.abs(report.readRate - 50) / 100 + .25, label: '阅读与收听',
      title: `${report.readRate}%`, metric: '文字阅读占比',
      body: report.readRate >= 50 ? '其余时间来自收听或朗读记录。' : '更多时间来自收听或朗读记录。'
    },
    report.topBooks.length >= 2 && {
      type: 'shelf', score: .28 + report.topBooks.length / 20, label: '时间还留在',
      title: `${report.topBooks.length} 本主要读物`, metric: '年度阅读排行',
      body: '这些书共同占据了年度阅读时长的前列。', books: report.topBooks
    }
  ].filter(Boolean).sort((left, right) => right.score - left.score).slice(0, 5);

  return [
    {
      type: 'opening', label: '年度阅读', title: `${report.year}，您留给阅读`,
      metric: formatDuration(report.totalMinutes),
      body: report.booksRead ? `读过 ${report.booksRead} 本。故事会从数据最清晰的部分开始。` : '故事会从数据最清晰的部分开始。'
    },
    ...candidates,
    {
      type: 'closing', label: `MY READING STORY · ${report.year}`,
      title: `${report.year}，阅读留下了一条自己的路径。`,
      metric: formatDuration(report.totalMinutes),
      body: [report.booksRead && `${report.booksRead} 本`, ...report.topics.slice(0, 3)].filter(Boolean).join(' · '),
      coverUrl: report.topBook.coverUrl
    }
  ];
}

export function buildIdentity(options) {
  const mode = options.identity || 'anonymous';
  if (!['name_avatar', 'name', 'anonymous'].includes(mode)) throw new Error('identity 只能是 name_avatar、name 或 anonymous。');
  if (mode === 'anonymous') return { mode };
  const nickname = cleanText(options.nickname, '昵称');
  if (nickname.length > 24) throw new Error('昵称不能超过 24 个字符。');
  if (mode === 'name') return { mode, nickname };
  return { mode, nickname, avatarUrl: normalizeHttpsUrl(options.avatarUrl, '头像') };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node prepare-story.mjs [--year 2026] [--identity anonymous|name|name_avatar] [--nickname 昵称] [--avatar-url https://...] [--output story.json]');
    return;
  }
  const { apiKey } = await loadConfiguration();

  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()));
  const year = options.year === undefined ? currentYear : Number(options.year);
  if (!Number.isInteger(year) || year < 2015 || year > currentYear) throw new Error(`year 必须是 2015–${currentYear}。`);
  const identity = buildIdentity(options);
  const baseTime = year === currentYear ? 0 : Math.floor(Date.UTC(year, 6, 1, 4) / 1000);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: '/readdata/detail', mode: 'annually', baseTime, skill_version: WEREAD_SKILL_VERSION })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`微信读书阅读统计请求失败（HTTP ${response.status}）。`);
  if (payload.upgrade_info) throw new Error(payload.upgrade_info.message || '微信读书 Skill 需要升级。');
  if (Number(payload.errcode) !== 0 && payload.errcode !== undefined) throw new Error(payload.errmsg || `微信读书接口错误：${payload.errcode}`);
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (data.upgrade_info) throw new Error(data.upgrade_info.message || '微信读书 Skill 需要升级。');

  const story = buildStoryFromReadData(data, { year, identity });
  const output = resolve(options.output || `weread-story-${year}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(story, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({
    output,
    year,
    totalMinutes: story.report.totalMinutes,
    booksRead: story.report.booksRead,
    focusPercent: story.report.focusPercent,
    topBook: story.report.topBook.title,
    topics: story.report.topics,
    share: story.share
  }, null, 2));
}

function parseArgs(args) {
  const options = {};
  const names = new Map([
    ['--year', 'year'], ['--identity', 'identity'], ['--nickname', 'nickname'],
    ['--avatar-url', 'avatarUrl'], ['--output', 'output']
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    const name = names.get(argument);
    if (!name || index + 1 >= args.length) throw new Error(`未知或缺少参数值：${argument}`);
    options[name] = args[index += 1];
  }
  return options;
}

function parseBooksRead(stats) {
  const value = (Array.isArray(stats) ? stats : []).find(item => item?.stat === '读过')?.counts;
  const match = String(value || '').match(/\d+/);
  return match && Number(match[0]) > 0 ? Number(match[0]) : null;
}

function collectTopics(categories, fallback) {
  const candidates = (Array.isArray(categories) ? categories : [])
    .filter(item => Number(item?.readingTime) > 0 || Number(item?.readingCount) > 0 || Number(item?.val) > 0)
    .flatMap(item => [item.categoryTitle, item.parentCategoryTitle]);
  if (Array.isArray(fallback)) candidates.push(...fallback);
  else if (typeof fallback === 'string') candidates.push(...fallback.split(/[·/、,，]/));
  const topics = [...new Set(candidates.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean))].slice(0, 4);
  return topics;
}

function collectRankedBooks(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      if (!item?.book?.title || !item.book.cover || Number(item.readTime) <= 0) return null;
      return {
        title: cleanText(item.book.title, '主书书名'),
        minutes: Math.max(1, Math.round(Number(item.readTime) / 60)),
        seconds: Number(item.readTime),
        coverUrl: normalizeHttpsUrl(item.book.cover, '主书封面'),
        categories: item.book.category
      };
    }).filter(Boolean);
}

function calculateCategoryFocus(categories) {
  const values = (Array.isArray(categories) ? categories : []).map(item => Number(item?.readingTime)).filter(value => value > 0);
  if (!values.length) return 0;
  return Math.max(...values) / values.reduce((sum, value) => sum + value, 0);
}

function selectPreferredAuthor(authors) {
  const author = (Array.isArray(authors) ? authors : []).find(item => typeof item?.name === 'string' && Number(item?.count) >= 2);
  return author ? { name: cleanText(author.name, '偏好作者'), count: Number(author.count) } : null;
}

function calculateReadingRhythm(preferTime) {
  const values = Array.isArray(preferTime) ? preferTime.map(Number) : [];
  if (values.length !== 24 || values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const groups = [
    { label: '清晨与上午', hours: [6, 7, 8, 9, 10, 11] }, { label: '午后', hours: [12, 13, 14, 15, 16, 17] },
    { label: '傍晚', hours: [18, 19, 20, 21] }, { label: '夜晚', hours: [22, 23, 0, 1, 2, 3, 4, 5] }
  ].map(group => ({ ...group, seconds: group.hours.reduce((sum, hour) => sum + values[(hour + 18) % 24], 0) }));
  const total = groups.reduce((sum, group) => sum + group.seconds, 0);
  const leader = groups.sort((left, right) => right.seconds - left.seconds)[0];
  return total >= 36_000 && leader.seconds / total >= .35 ? { label: leader.label, share: leader.seconds / total } : null;
}

function optionalPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function optionalPercentage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 100 ? Math.round(number) : null;
}

function percentage(part, whole) {
  return Math.min(100, Math.max(1, Math.round(part / whole * 100)));
}

function formatDuration(minutes) {
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}

function normalizeHttpsUrl(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}地址缺失。`);
  const normalized = value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim().replace(/^http:\/\//i, 'https://');
  let url;
  try { url = new URL(normalized); }
  catch { throw new Error(`${name}地址无效。`); }
  if (url.protocol !== 'https:') throw new Error(`${name}必须使用 HTTPS 地址。`);
  return url.href;
}

function cleanText(value, name) {
  if (typeof value !== 'string') throw new Error(`${name}缺失。`);
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${name}无效。`);
  return text;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name}必须是正数。`);
  return number;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
