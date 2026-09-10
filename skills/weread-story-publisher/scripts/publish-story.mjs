import { readFile } from 'node:fs/promises';

const [payloadPath] = process.argv.slice(2);
const baseUrl = process.env.WEREAD_STORY_PUBLISH_URL?.replace(/\/$/, '');
const apiKey = process.env.WEREAD_STORY_PUBLISH_API_KEY;

if (!payloadPath || !baseUrl || !apiKey) {
  throw new Error('需要 payload 文件、WEREAD_STORY_PUBLISH_URL 和 WEREAD_STORY_PUBLISH_API_KEY。');
}

const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
const response = await fetch(`${baseUrl}/api/stories`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || '发布失败。');
console.log(JSON.stringify(result, null, 2));
