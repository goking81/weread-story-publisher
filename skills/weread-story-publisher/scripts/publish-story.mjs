import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import QRCode from 'qrcode';
import { loadConfiguration } from './config.mjs';

const [payloadPath] = process.argv.slice(2);
const { publishUrl: baseUrl } = await loadConfiguration({ requireApiKey: false });

if (!payloadPath) {
  throw new Error('需要 payload 文件。');
}

const story = JSON.parse(await readFile(payloadPath, 'utf8'));
const totalHours = Math.floor(story.report.totalMinutes / 60);
const totalMinutes = story.report.totalMinutes % 60;
const key = randomBytes(32);
// 撤销凭据独立生成，拿到分享链接的读者不能删除报告。
const revokeToken = randomBytes(32).toString('base64url');
const iv = randomBytes(12);
const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, Buffer.from(JSON.stringify(story), 'utf8'));
const payload = {
  envelope: { version: 1, iv: iv.toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') },
  revokeHash: createHash('sha256').update(revokeToken).digest('base64url'),
  share: story.share || {
    title: `${story.report.year} 阅读故事 · ${totalHours}小时${totalMinutes}分`,
    description: `${totalHours}小时${totalMinutes}分，记录这一年的阅读。`,
    imageUrl: story.report.topBook.coverUrl
  },
  expiresInDays: story.expiresInDays
};
const response = await fetch(`${baseUrl}/api/stories`, {
  method: 'POST',
  signal: AbortSignal.timeout(60000),
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const result = await response.json().catch(() => null);
if (!result) throw new Error(`发布服务返回了无效响应（HTTP ${response.status}），请稍后重试。`);
if (!response.ok) throw new Error(result.error || '发布失败。');

const url = `${result.url}#${key.toString('base64url')}`;
const qrPath = process.env.WEREAD_STORY_QR_PATH || join(dirname(payloadPath), `${basename(payloadPath, extname(payloadPath))}.qr.png`);
const urlFile = process.env.WEREAD_STORY_URL_OUTPUT || join(tmpdir(), `weread-story-${result.slug}.url`);
const revokeFile = `${urlFile}.revoke.json`;
try {
  await writeFile(revokeFile, JSON.stringify({ url: result.url, credential: payload.revokeHash }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await writeFile(urlFile, url, { encoding: 'utf8', mode: 0o600 });
  await QRCode.toFile(qrPath, url, { width: 420, margin: 4, errorCorrectionLevel: 'M' });
} catch {
  // 本地凭据或二维码保存失败时回滚本次发布，避免留下用户无法管理的链接。
  const rollback = await fetch(`${baseUrl}/api/stories/${result.slug}`, {
    method: 'DELETE', signal: AbortSignal.timeout(30000), headers: { 'X-Story-Revoke': payload.revokeHash }
  }).catch(() => null);
  throw new Error(rollback?.status === 204
    ? '本地分享文件保存失败，本次发布已撤销。请检查输出目录权限及是否存在同名撤销文件后重试。'
    : '本地分享文件保存失败，且无法确认撤销。请保留已生成的撤销文件并联系站点管理员；本次上传可能仍会保留至到期。');
}
console.log(JSON.stringify({ slug: result.slug, expiresAt: result.expiresAt, qrPath, urlFile, revokeFile }, null, 2));
