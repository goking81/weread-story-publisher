import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API_URL = 'https://i.weread.qq.com/api/agent/gateway';
const WEREAD_SKILL_VERSION = '1.0.4';

export function buildStoryFromReadData(data, { year, identity, expiresInDays = 30 }) {
  const totalSeconds = positiveNumber(data.totalReadTime, 'totalReadTime');
  const rankedBook = (Array.isArray(data.readLongest) ? data.readLongest : [])
    .find(item => item?.book?.title && item?.book?.cover && Number(item.readTime) > 0);
  if (!rankedBook) throw new Error('年度统计中没有可用于主视觉的电子书及封面。');

  const booksRead = parseBooksRead(data.readStat);
  const coverUrl = normalizeHttpsUrl(rankedBook.book.cover, '主书封面');
  const topics = collectTopics(data.preferCategory, rankedBook.book.category);
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const topBookMinutes = Math.max(1, Math.round(Number(rankedBook.readTime) / 60));
  const focusPercent = Math.min(100, Math.max(1, Math.round(Number(rankedBook.readTime) / totalSeconds * 100)));
  const primaryTopic = topics[0];
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return {
    identity,
    report: {
      year,
      focusPercent,
      totalMinutes,
      booksRead,
      topBook: {
        title: cleanText(rankedBook.book.title, '主书书名'),
        minutes: topBookMinutes,
        coverUrl
      },
      topics
    },
    share: {
      title: `${year}，我一直在往${primaryTopic}深处走`,
      description: `${hours}小时${minutes}分，${focusPercent}%的阅读时间留给了同一本书`,
      imageUrl: coverUrl
    },
    expiresInDays
  };
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
  const apiKey = process.env.WEREAD_API_KEY;
  if (!apiKey) throw new Error('未设置 WEREAD_API_KEY。请先在本机环境变量中配置微信读书 API Key。');

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
  if (!match || Number(match[0]) < 1) throw new Error('年度统计中缺少可靠的“读过”本数。');
  return Number(match[0]);
}

function collectTopics(categories, fallback) {
  const candidates = (Array.isArray(categories) ? categories : [])
    .filter(item => Number(item?.readingTime) > 0 || Number(item?.readingCount) > 0 || Number(item?.val) > 0)
    .flatMap(item => [item.categoryTitle, item.parentCategoryTitle]);
  if (Array.isArray(fallback)) candidates.push(...fallback);
  else if (typeof fallback === 'string') candidates.push(...fallback.split(/[·/、,，]/));
  const topics = [...new Set(candidates.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean))].slice(0, 4);
  return topics.length ? topics : ['阅读'];
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
