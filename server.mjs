import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = dirname(fileURLToPath(import.meta.url));
const port = positiveInteger(process.env.PORT, 3000);
const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
const publishApiKey = process.env.PUBLISH_API_KEY;
const dataFile = resolve(root, process.env.STORY_DATA_FILE || './data/stories.json');
const staticFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/story.css', 'story.css'],
  ['/story.js', 'story.js'],
  ['/s/story.css', 'story.css'],
  ['/s/story.js', 'story.js']
]);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
let stories = await loadStories();

if (!publishApiKey || publishApiKey.length < 24) {
  throw new Error('PUBLISH_API_KEY 必须设置为至少 24 个字符的随机密钥。');
}

createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : '服务暂时不可用。' });
  }
}).listen(port, () => console.log(`WeRead Story Publisher is listening on :${port}`));

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === 'GET' && pathname === '/health') return sendJson(response, 200, { ok: true });
  if (request.method === 'POST' && pathname === '/api/stories') return createStory(request, response, url);

  const storyMatch = pathname.match(/^\/api\/stories\/([A-Za-z0-9_-]{12,})$/);
  if (request.method === 'GET' && storyMatch) return getStory(response, storyMatch[1]);
  if (request.method === 'DELETE' && storyMatch) return revokeStory(request, response, storyMatch[1]);

  const qrMatch = pathname.match(/^\/api\/stories\/([A-Za-z0-9_-]{12,})\/qr\.png$/);
  if (request.method === 'GET' && qrMatch) return getQr(response, qrMatch[1], url);

  const publicMatch = pathname.match(/^\/s\/([A-Za-z0-9_-]{12,})$/);
  if (request.method === 'GET' && publicMatch) {
    if (!findActiveStory(publicMatch[1])) return sendText(response, 404, '这份阅读故事已失效或不存在。');
    return sendFile(response, 'index.html');
  }

  const assetMatch = pathname.match(/^\/(?:s\/)?assets\/([A-Za-z0-9._-]+)$/);
  if (request.method === 'GET' && assetMatch) return sendFile(response, join('assets', assetMatch[1]));
  if (request.method === 'GET' && staticFiles.has(pathname)) return sendFile(response, staticFiles.get(pathname));
  sendText(response, 404, 'Not found');
}

async function createStory(request, response, url) {
  if (!isAuthorized(request)) return sendJson(response, 401, { error: '未授权的发布请求。' });
  const payload = await readJson(request);
  const story = normalizeStory(payload);
  stories.push(story);
  await saveStories();
  const origin = originFor(url);
  sendJson(response, 201, { slug: story.slug, url: `${origin}/s/${story.slug}`, qrUrl: `${origin}/api/stories/${story.slug}/qr.png`, expiresAt: story.expiresAt });
}

function getStory(response, slug) {
  const story = findActiveStory(slug);
  if (!story) return sendJson(response, 404, { error: '故事已失效或不存在。' });
  sendJson(response, 200, publicStory(story));
}

async function revokeStory(request, response, slug) {
  if (!isAuthorized(request)) return sendJson(response, 401, { error: '未授权的撤销请求。' });
  const index = stories.findIndex(story => story.slug === slug);
  if (index === -1) return sendJson(response, 404, { error: '故事不存在。' });
  stories.splice(index, 1);
  await saveStories();
  response.writeHead(204).end();
}

async function getQr(response, slug, url) {
  if (!findActiveStory(slug)) return sendJson(response, 404, { error: '故事已失效或不存在。' });
  const buffer = await QRCode.toBuffer(`${originFor(url)}/s/${slug}`, { type: 'png', width: 420, margin: 2, errorCorrectionLevel: 'M' });
  response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' }).end(buffer);
}

function normalizeStory(payload) {
  const report = payload?.report;
  const identity = payload?.identity || {};
  if (!report || typeof report !== 'object') throw badRequest('report 是必填对象。');
  const year = boundedInteger(report.year, 2020, 2100, 'report.year');
  const focusPercent = boundedInteger(report.focusPercent, 1, 100, 'report.focusPercent');
  const totalMinutes = boundedInteger(report.totalMinutes, 1, 525600, 'report.totalMinutes');
  const booksRead = boundedInteger(report.booksRead, 1, 1000, 'report.booksRead');
  const topBook = report.topBook;
  if (!topBook || typeof topBook !== 'object') throw badRequest('report.topBook 是必填对象。');
  const title = boundedText(topBook.title, 1, 80, 'report.topBook.title');
  const minutes = boundedInteger(topBook.minutes, 1, totalMinutes, 'report.topBook.minutes');
  const coverUrl = safeImageUrl(topBook.coverUrl, 'report.topBook.coverUrl');
  if (!Array.isArray(report.topics) || report.topics.length < 1 || report.topics.length > 4) throw badRequest('report.topics 需要 1–4 个关键词。');
  const topics = report.topics.map((topic, index) => boundedText(topic, 1, 16, `report.topics[${index}]`));
  const mode = ['name_avatar', 'name', 'anonymous'].includes(identity.mode) ? identity.mode : 'name_avatar';
  const nickname = mode === 'anonymous' ? '' : boundedText(identity.nickname, 1, 32, 'identity.nickname');
  const avatarUrl = mode === 'name_avatar' ? safeImageUrl(identity.avatarUrl, 'identity.avatarUrl') : '';
  const expiresInDays = payload.expiresInDays === undefined ? 30 : boundedInteger(payload.expiresInDays, 1, 365, 'expiresInDays');
  return {
    slug: randomBytes(18).toString('base64url'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
    identity: { mode, nickname, avatarUrl },
    report: { year, focusPercent, totalMinutes, booksRead, topBook: { title, minutes, coverUrl }, topics }
  };
}

function publicStory(story) {
  return { identity: story.identity, report: story.report, expiresAt: story.expiresAt };
}

function findActiveStory(slug) {
  const story = stories.find(candidate => candidate.slug === slug);
  return story && Date.parse(story.expiresAt) > Date.now() ? story : null;
}

function isAuthorized(request) {
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!provided || provided.length !== publishApiKey.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(publishApiKey));
}

async function readJson(request) {
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > 30000) throw badRequest('请求体不能超过 30KB。');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw badRequest('请求体必须是 JSON。'); }
}

async function loadStories() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    return Array.isArray(parsed.stories) ? parsed.stories : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveStories() {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify({ version: 1, stories }, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, dataFile);
}

async function sendFile(response, relativePath) {
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) return sendText(response, 403, 'Forbidden');
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' }).end(body);
  } catch (error) {
    if (error.code === 'ENOENT') return sendText(response, 404, 'Not found');
    throw error;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

function sendText(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
}

function originFor(url) {
  return publicBaseUrl || `${url.protocol}//${url.host}`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw badRequest(`${name} 必须在 ${minimum}–${maximum} 之间。`);
  return value;
}

function boundedText(value, minimum, maximum, name) {
  if (typeof value !== 'string') throw badRequest(`${name} 必须是文字。`);
  const text = value.trim();
  if (text.length < minimum || text.length > maximum) throw badRequest(`${name} 长度必须在 ${minimum}–${maximum} 之间。`);
  return text;
}

function safeImageUrl(value, name) {
  const text = boundedText(value, 1, 2048, name);
  if (text.startsWith('/assets/')) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return url.href;
  } catch { /* 统一返回请求参数错误。 */ }
  throw badRequest(`${name} 必须是 HTTPS 图片地址或站内 assets 地址。`);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
