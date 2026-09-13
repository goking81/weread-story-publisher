import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

// 沙盒中 Wrangler 无法读取上层目录时，按其同一套静态资源直传协议发布。
const require = createRequire(import.meta.url);
const { hash } = require('blake3-wasm');
const root = resolve(import.meta.dirname, '..');
const accountId = '38402ff6ee1eaf0caf1bf10536d44849';
const scriptName = 'weread-story-publisher';
const ignored = new Set(['/ .assetsignore'.replace(' ', ''), '/_headers', '/_redirects', '/assets/history-deep-republic-set-hd.jpg', '/assets/history-deep-republic-weread.jpg']);

const config = await readFile(resolve(root, '.wrangler-config/.wrangler/config/default.toml'), 'utf8');
const token = /^oauth_token\s*=\s*"([^"]+)"/m.exec(config)?.[1];
if (!token) throw new Error('未找到 Wrangler 登录凭据；请重新执行 wrangler login。');

async function api(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(`Cloudflare 请求失败：${response.status} ${body?.errors?.[0]?.message || ''}`);
  return body.result;
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async entry => {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return files(fullPath);
    return entry.isFile() ? [fullPath] : [];
  }));
  return paths.flat();
}

const assetDirectory = resolve(root, 'public');
const assets = [];
for (const path of await files(assetDirectory)) {
  const urlPath = `/${relative(assetDirectory, path).split(sep).join('/')}`;
  if (ignored.has(urlPath)) continue;
  const content = await readFile(path);
  assets.push({ path, urlPath, content, hash: hash(content.toString('base64') + extname(path).slice(1)).toString('hex').slice(0, 32), size: (await stat(path)).size });
}
const manifest = Object.fromEntries(assets.map(asset => [asset.urlPath, { hash: asset.hash, size: asset.size }]));
const session = await api(`/accounts/${accountId}/workers/scripts/${scriptName}/assets-upload-session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ manifest })
});

let completionJwt = session.jwt;
for (const bucket of session.buckets.flat()) {
  const asset = assets.find(item => item.hash === bucket);
  if (!asset) throw new Error('Cloudflare 请求了不存在的静态资源。');
  const form = new FormData();
  form.append(asset.hash, new Blob([asset.content.toString('base64')], { type: 'application/null' }), asset.hash);
  const result = await api(`/accounts/${accountId}/workers/assets/upload?base64=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.jwt}` },
    body: form
  });
  completionJwt = result.jwt || completionJwt;
}
if (!completionJwt) throw new Error('静态资源上传未返回完成凭据。');

const form = new FormData();
form.set('metadata', JSON.stringify({
  main_module: 'worker.js',
  compatibility_date: '2026-09-11',
  bindings: [
    { name: 'WEREAD_STORIES', type: 'kv_namespace', namespace_id: 'dae79f0f7d704be4886456edd06109eb' },
    { name: 'PUBLISH_RATE_LIMITER', type: 'durable_object_namespace', class_name: 'PublishRateLimiter' },
    { name: 'ASSETS', type: 'assets' },
    { name: 'DEFAULT_EXPIRY_DAYS', type: 'plain_text', text: '30' },
    { name: 'PUBLISH_MAX_PUBLISHES_PER_HOUR', type: 'plain_text', text: '5' }
  ],
  keep_bindings: ['secret_text'],
  assets: { jwt: completionJwt, config: { run_worker_first: true } },
  observability: { enabled: true, head_sampling_rate: 0.1 },
  annotations: { 'workers/message': 'v0.1.4 data-driven stories' }
}));
form.set('worker.js', new Blob([await readFile(resolve(root, 'src/worker.js'))], { type: 'application/javascript+module' }), 'worker.js');
const version = await api(`/accounts/${accountId}/workers/scripts/${scriptName}/versions?bindings_inherit=strict`, { method: 'POST', body: form });
await api(`/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    strategy: 'percentage',
    versions: [{ version_id: version.id, percentage: 100 }],
    annotations: { 'workers/message': 'v0.1.4 data-driven stories' }
  })
});
console.log(`已发布 ${assets.length} 个静态资源和动态 Story Worker。`);
