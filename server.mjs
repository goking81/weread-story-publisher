import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = positiveInteger(process.env.PORT, 3000);
const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
const dataFile = resolve(root, process.env.STORY_DATA_FILE || './data/stories.json');
const defaultExpiryDays = boundedEnvironmentInteger(process.env.DEFAULT_EXPIRY_DAYS, 30, 1, 365);
const maxPublishesPerHour = boundedEnvironmentInteger(process.env.PUBLISH_MAX_PUBLISHES_PER_HOUR, 5, 1, 100);
const publishLimits = new Map();
const staticFiles = new Map([
  ['/', 'public/index.html'],
  ['/index.html', 'public/index.html'],
  ['/story.css', 'public/story.css'],
  ['/story.js', 'public/story.js'],
  ['/qrcode.mjs', 'public/qrcode.mjs']
]);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
let stories = await loadStories();

await purgeExpiredStories();
setInterval(() => purgeExpiredStories().catch(console.error), 3600000).unref();

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

  const publicMatch = pathname.match(/^\/s\/([A-Za-z0-9_-]{12,})$/);
  if (request.method === 'GET' && publicMatch) {
    if (!findActiveStory(publicMatch[1])) return sendText(response, 404, '这份阅读故事已失效或不存在。');
    return sendFile(response, 'public/index.html');
  }

  const assetMatch = pathname.match(/^\/(?:s\/)?assets\/([A-Za-z0-9._-]+)$/);
  if (request.method === 'GET' && assetMatch) return sendFile(response, join('public', 'assets', assetMatch[1]));
  if (request.method === 'GET' && staticFiles.has(pathname)) return sendFile(response, staticFiles.get(pathname));
  sendText(response, 404, 'Not found');
}

async function createStory(request, response, url) {
  assertWithinPublishLimit(request);
  const payload = await readJson(request);
  const story = normalizeEnvelope(payload);
  stories.push(story);
  await saveStories();
  const origin = originFor(url);
  sendJson(response, 201, { slug: story.slug, url: `${origin}/s/${story.slug}`, expiresAt: story.expiresAt });
}

function getStory(response, slug) {
  const story = findActiveStory(slug);
  if (!story) return sendJson(response, 404, { error: '故事已失效或不存在。' });
  sendJson(response, 200, { envelope: story.envelope, expiresAt: story.expiresAt });
}

async function revokeStory(request, response, slug) {
  const index = stories.findIndex(story => story.slug === slug);
  if (index === -1) return sendJson(response, 404, { error: '故事不存在。' });
  const revokeHash = request.headers['x-story-revoke'];
  if (!sameSecret(revokeHash, stories[index].revokeHash)) return sendJson(response, 401, { error: '撤销凭据无效。' });
  stories.splice(index, 1);
  await saveStories();
  response.writeHead(204).end();
}

function normalizeEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('请求体必须是加密信封。');
  const allowedKeys = new Set(['envelope', 'revokeHash', 'expiresInDays']);
  if (Object.keys(payload).some(key => !allowedKeys.has(key))) throw badRequest('发布接口不接收明文阅读数据。');
  const envelope = payload.envelope;
  if (!envelope || typeof envelope !== 'object' || envelope.version !== 1) throw badRequest('无效的加密信封版本。');
  const iv = boundedBase64Url(envelope.iv, 16, 32, 'envelope.iv');
  const ciphertext = boundedBase64Url(envelope.ciphertext, 1, 86000, 'envelope.ciphertext');
  const revokeHash = boundedBase64Url(payload.revokeHash, 43, 43, 'revokeHash');
  const expiresInDays = payload.expiresInDays === undefined ? defaultExpiryDays : boundedInteger(payload.expiresInDays, 1, 365, 'expiresInDays');
  return {
    slug: randomBytes(18).toString('base64url'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
    revokeHash,
    envelope: { version: 1, iv, ciphertext }
  };
}

function findActiveStory(slug) {
  const story = stories.find(candidate => candidate.slug === slug);
  return story && Date.parse(story.expiresAt) > Date.now() ? story : null;
}

async function purgeExpiredStories() {
  const now = Date.now();
  const activeStories = stories.filter(story => Date.parse(story.expiresAt) > now);
  if (activeStories.length === stories.length) return;
  stories = activeStories;
  await saveStories();
}

function sameSecret(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function assertWithinPublishLimit(request) {
  const client = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (publishLimits.get(client) || []).filter(timestamp => now - timestamp < 3600000);
  if (recent.length >= maxPublishesPerHour) throw tooManyRequests('此网络的发布次数已达本小时上限。');
  recent.push(now);
  publishLimits.set(client, recent);
}

async function readJson(request) {
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > 90000) throw badRequest('请求体不能超过 90KB。');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw badRequest('请求体必须是 JSON。'); }
}

async function loadStories() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    return Array.isArray(parsed.stories) ? parsed.stories.filter(isEncryptedStory) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function isEncryptedStory(story) {
  return story?.envelope?.version === 1 && typeof story.revokeHash === 'string' && typeof story.expiresAt === 'string';
}

async function saveStories() {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify({ version: 2, stories }, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, dataFile);
}

async function sendFile(response, relativePath) {
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) return sendText(response, 403, 'Forbidden');
  try {
    const body = await readFile(filePath);
    const extension = extname(filePath);
    const headers = {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': ['.html', '.css', '.js', '.mjs'].includes(extension) ? 'no-cache' : 'public, max-age=300'
    };
    if (extension === '.html') headers['Referrer-Policy'] = 'no-referrer';
    response.writeHead(200, headers).end(body);
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

function boundedEnvironmentInteger(value, fallback, minimum, maximum) {
  return value === undefined ? fallback : boundedInteger(Number(value), minimum, maximum, '环境变量');
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw badRequest(`${name} 必须在 ${minimum}–${maximum} 之间。`);
  return value;
}

function boundedBase64Url(value, minimum, maximum, name) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || !/^[A-Za-z0-9_-]+$/.test(value)) throw badRequest(`${name} 格式无效。`);
  return value;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function tooManyRequests(message) {
  const error = new Error(message);
  error.statusCode = 429;
  return error;
}
