import { createHash } from 'node:crypto';

const [storyUrl] = process.argv.slice(2);
if (!storyUrl) throw new Error('需要完整的加密分享链接。');

const url = new URL(storyUrl);
const slug = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{12,})$/)?.[1];
const key = url.hash.slice(1);
if (!slug || !key) throw new Error('链接缺少故事编号或加密密钥。');

const revokeHash = createHash('sha256').update(Buffer.from(key, 'base64url')).digest('base64url');
const response = await fetch(`${url.origin}/api/stories/${slug}`, { method: 'DELETE', headers: { 'X-Story-Revoke': revokeHash } });
if (response.status === 204) console.log('已撤销这份阅读故事。');
else throw new Error((await response.json()).error || '撤销失败。');
