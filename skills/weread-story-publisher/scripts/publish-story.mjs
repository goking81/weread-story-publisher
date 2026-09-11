import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import QRCode from 'qrcode';

const [payloadPath] = process.argv.slice(2);
const baseUrl = process.env.WEREAD_STORY_PUBLISH_URL?.replace(/\/$/, '');
const inviteCode = process.env.WEREAD_STORY_INVITE_CODE;

if (!payloadPath || !baseUrl || !inviteCode) {
  throw new Error('需要 payload 文件、WEREAD_STORY_PUBLISH_URL 和 WEREAD_STORY_INVITE_CODE。');
}

const story = JSON.parse(await readFile(payloadPath, 'utf8'));
const totalHours = Math.floor(story.report.totalMinutes / 60);
const totalMinutes = story.report.totalMinutes % 60;
const primaryTopic = story.report.topics[0] || '阅读';
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
    title: `${story.report.year}，我一直在往${primaryTopic}深处走`,
    description: `${totalHours}小时${totalMinutes}分，${story.report.focusPercent}%的阅读时间留给了同一套书`,
    imageUrl: story.report.topBook.coverUrl
  },
  expiresInDays: story.expiresInDays
};
const response = await fetch(`${baseUrl}/api/stories`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Story-Invite': inviteCode },
  body: JSON.stringify(payload)
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || '发布失败。');

const url = `${result.url}#${key.toString('base64url')}`;
const qrPath = process.env.WEREAD_STORY_QR_PATH || join(dirname(payloadPath), `${basename(payloadPath, extname(payloadPath))}.qr.png`);
const urlFile = process.env.WEREAD_STORY_URL_OUTPUT || join(tmpdir(), `weread-story-${result.slug}.url`);
const revokeFile = `${urlFile}.revoke.json`;
await writeFile(revokeFile, JSON.stringify({ url: result.url, credential: payload.revokeHash }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
await writeFile(urlFile, url, { encoding: 'utf8', mode: 0o600 });
await QRCode.toFile(qrPath, url, { width: 420, margin: 4, errorCorrectionLevel: 'M' });
console.log(JSON.stringify({ slug: result.slug, expiresAt: result.expiresAt, qrPath, urlFile, revokeFile }, null, 2));
