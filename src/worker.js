import { DurableObject } from 'cloudflare:workers';

const encoder = new TextEncoder();
const storyPrefix = 'story:';

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: error.statusCode ? error.message : '服务暂时不可用。' }, error.statusCode || 500);
    }
  }
};

export class PublishRateLimiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS rate_windows (bucket INTEGER PRIMARY KEY, requests INTEGER NOT NULL)');
  }

  allow(bucket, maximum) {
    const current = this.ctx.storage.sql.exec('SELECT requests FROM rate_windows WHERE bucket = ?', bucket).toArray()[0]?.requests || 0;
    if (current >= maximum) return false;
    this.ctx.storage.sql.exec(
      'INSERT INTO rate_windows (bucket, requests) VALUES (?, ?) ON CONFLICT(bucket) DO UPDATE SET requests = excluded.requests',
      bucket,
      current + 1
    );
    this.ctx.storage.sql.exec('DELETE FROM rate_windows WHERE bucket < ?', bucket - 1);
    return true;
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === 'GET' && pathname === '/health') return json({ ok: true });
  if (request.method === 'POST' && pathname === '/api/stories') return createStory(request, env, url);

  const storyMatch = pathname.match(/^\/api\/stories\/([A-Za-z0-9_-]{12,})$/);
  if (request.method === 'GET' && storyMatch) return getStory(env, storyMatch[1]);
  if (request.method === 'DELETE' && storyMatch) return revokeStory(request, env, storyMatch[1]);

  if (request.method === 'GET' && pathname.match(/^\/s\/[A-Za-z0-9_-]{12,}$/)) return storyPage(request, env);
  return env.ASSETS.fetch(request);
}

async function createStory(request, env, url) {
  if (!await isValidInvite(request.headers.get('X-Story-Invite'), env.PUBLISH_INVITE_CODES)) return json({ error: '邀请码无效。' }, 401);
  await assertWithinPublishLimit(request, env);
  const payload = await readJson(request);
  const story = normalizeEnvelope(payload, env.DEFAULT_EXPIRY_DAYS);
  await env.WEREAD_STORIES.put(`${storyPrefix}${story.slug}`, JSON.stringify(story), { expirationTtl: story.expiresInDays * 86400 });
  return json({ slug: story.slug, url: `${url.origin}/s/${story.slug}`, expiresAt: story.expiresAt }, 201);
}

async function getStory(env, slug) {
  const story = await readStory(env, slug);
  if (!story) return json({ error: '故事已失效或不存在。' }, 404);
  return json({ envelope: story.envelope, expiresAt: story.expiresAt });
}

async function revokeStory(request, env, slug) {
  const story = await readStory(env, slug);
  if (!story) return json({ error: '故事不存在。' }, 404);
  if (!await sameDigest(request.headers.get('X-Story-Revoke'), story.revokeHash)) return json({ error: '撤销凭据无效。' }, 401);
  await env.WEREAD_STORIES.delete(`${storyPrefix}${slug}`);
  return new Response(null, { status: 204 });
}

async function storyPage(request, env) {
  const slug = new URL(request.url).pathname.split('/').pop();
  const story = await readStory(env, slug);
  const assetUrl = new URL('/', request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');
  if (!story?.share) return new Response(response.body, { status: response.status, headers });

  const pageUrl = new URL(request.url);
  pageUrl.hash = '';
  const imageUrl = new URL(story.share.imageUrl, pageUrl.origin).href;
  const rewritten = new HTMLRewriter()
    .on('title', textHandler(story.share.title))
    .on('#share-description', attributeHandler('content', story.share.description))
    .on('#share-og-title', attributeHandler('content', story.share.title))
    .on('#share-og-description', attributeHandler('content', story.share.description))
    .on('#share-og-image', attributeHandler('content', imageUrl))
    .on('#share-og-url', attributeHandler('content', pageUrl.href))
    .on('#share-item-name', attributeHandler('content', story.share.title))
    .on('#share-item-description', attributeHandler('content', story.share.description))
    .on('#share-item-image', attributeHandler('content', imageUrl))
    .on('#share-image-src', attributeHandler('href', imageUrl))
    .on('#share-twitter-title', attributeHandler('content', story.share.title))
    .on('#share-twitter-description', attributeHandler('content', story.share.description))
    .on('#share-twitter-image', attributeHandler('content', imageUrl))
    .transform(response);
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

async function readStory(env, slug) {
  const raw = await env.WEREAD_STORIES.get(`${storyPrefix}${slug}`);
  if (!raw) return null;
  try {
    const story = JSON.parse(raw);
    return Date.parse(story.expiresAt) > Date.now() ? story : null;
  } catch {
    return null;
  }
}

function normalizeEnvelope(payload, configuredDefault) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('请求体必须是加密信封。');
  const allowedKeys = new Set(['envelope', 'revokeHash', 'expiresInDays', 'share']);
  if (Object.keys(payload).some(key => !allowedKeys.has(key))) throw badRequest('发布接口不接收明文阅读数据。');
  const envelope = payload.envelope;
  if (!envelope || typeof envelope !== 'object' || envelope.version !== 1) throw badRequest('无效的加密信封版本。');
  const expiresInDays = payload.expiresInDays === undefined
    ? boundedInteger(Number(configuredDefault), 1, 365, 'DEFAULT_EXPIRY_DAYS')
    : boundedInteger(payload.expiresInDays, 1, 365, 'expiresInDays');
  return {
    slug: randomSlug(),
    expiresInDays,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
    revokeHash: boundedBase64Url(payload.revokeHash, 43, 43, 'revokeHash'),
    share: normalizeShare(payload.share),
    envelope: {
      version: 1,
      iv: boundedBase64Url(envelope.iv, 16, 32, 'envelope.iv'),
      ciphertext: boundedBase64Url(envelope.ciphertext, 1, 86000, 'envelope.ciphertext')
    }
  };
}

function normalizeShare(share) {
  if (share === undefined) return null;
  if (!share || typeof share !== 'object' || Array.isArray(share)) throw badRequest('share 格式无效。');
  const allowedKeys = new Set(['title', 'description', 'imageUrl']);
  if (Object.keys(share).some(key => !allowedKeys.has(key))) throw badRequest('share 包含未知字段。');
  const title = boundedText(share.title, 8, 60, 'share.title');
  const description = boundedText(share.description, 1, 120, 'share.description');
  const imageUrl = boundedText(share.imageUrl, 1, 2000, 'share.imageUrl');
  let parsed;
  try { parsed = new URL(imageUrl, 'https://share.invalid'); }
  catch { throw badRequest('share.imageUrl 格式无效。'); }
  if (parsed.protocol !== 'https:' || (!imageUrl.startsWith('/') && parsed.origin === 'https://share.invalid')) throw badRequest('share.imageUrl 必须是 HTTPS 地址或站内绝对路径。');
  return { title, description, imageUrl };
}

function boundedText(value, minimum, maximum, name) {
  if (typeof value !== 'string') throw badRequest(`${name} 格式无效。`);
  const text = value.trim();
  if (text.length < minimum || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) throw badRequest(`${name} 长度或字符无效。`);
  return text;
}

function attributeHandler(name, value) {
  return { element(element) { element.setAttribute(name, value); } };
}

function textHandler(value) {
  return { element(element) { element.setInnerContent(value); } };
}

async function assertWithinPublishLimit(request, env) {
  if (!env.RATE_LIMIT_SALT) throw new Error('RATE_LIMIT_SALT 尚未配置。');
  const client = request.headers.get('CF-Connecting-IP') || 'unknown';
  const identity = await digestBase64Url(`${env.RATE_LIMIT_SALT}:${client}`);
  const bucket = Math.floor(Date.now() / 3600000);
  const maximum = boundedInteger(Number(env.PUBLISH_MAX_PUBLISHES_PER_HOUR), 1, 100, 'PUBLISH_MAX_PUBLISHES_PER_HOUR');
  if (!await env.PUBLISH_RATE_LIMITER.getByName(identity).allow(bucket, maximum)) throw tooManyRequests('此网络的发布次数已达本小时上限。');
}

async function isValidInvite(provided, configuredCodes) {
  if (typeof provided !== 'string' || !configuredCodes) return false;
  return (await Promise.all(configuredCodes.split(',').map(code => sameDigest(provided, code.trim())))).some(Boolean);
}

async function sameDigest(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  const [providedHash, expectedHash] = await Promise.all([digest(provided), digest(expected)]);
  let difference = providedHash.length ^ expectedHash.length;
  for (let index = 0; index < Math.min(providedHash.length, expectedHash.length); index += 1) difference |= providedHash[index] ^ expectedHash[index];
  return difference === 0;
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function digestBase64Url(value) {
  return bytesToBase64Url(await digest(value));
}

function randomSlug() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > 90000) throw badRequest('请求体不能超过 90KB。');
  const reader = request.body?.getReader();
  if (!reader) throw badRequest('请求体必须是 JSON。');
  const parts = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 90000) {
      await reader.cancel();
      throw badRequest('请求体不能超过 90KB。');
    }
    parts.push(value);
  }
  const body = await new Blob(parts).text();
  try { return JSON.parse(body); }
  catch { throw badRequest('请求体必须是 JSON。'); }
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw badRequest(`${name} 必须在 ${minimum}–${maximum} 之间。`);
  return value;
}

function boundedBase64Url(value, minimum, maximum, name) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || !/^[A-Za-z0-9_-]+$/.test(value)) throw badRequest(`${name} 格式无效。`);
  return value;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
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
