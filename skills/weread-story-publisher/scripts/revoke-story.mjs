import { readFile } from 'node:fs/promises';

const [revokeFile] = process.argv.slice(2);
if (!revokeFile) throw new Error('需要发布时生成的本地 .revoke.json 管理文件。');
const { url: storyUrl, credential } = JSON.parse(await readFile(revokeFile, 'utf8'));

const url = new URL(storyUrl);
const slug = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{12,})$/)?.[1];
if (!slug || !/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error('撤销文件格式无效。');

const response = await fetch(`${url.origin}/api/stories/${slug}`, { method: 'DELETE', headers: { 'X-Story-Revoke': credential } });
if (response.status === 204) console.log('已撤销这份阅读故事。');
else throw new Error((await response.json()).error || '撤销失败。');
