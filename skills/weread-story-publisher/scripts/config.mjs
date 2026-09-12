import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const DEFAULT_PUBLISH_URL = 'https://readstory.learnbox.cc';

export function getConfigPath() {
  const base = process.env.WEREAD_STORY_CONFIG_DIR
    || (platform() === 'win32' && process.env.APPDATA
      ? join(process.env.APPDATA, 'WeReadStoryPublisher')
      : platform() === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'WeReadStoryPublisher')
        : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'weread-story-publisher'));
  return join(resolve(base), 'credentials.json');
}

export async function loadConfiguration() {
  let saved = {};
  try {
    saved = JSON.parse(await readFile(getConfigPath(), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('本地微信读书配置文件无法读取，请重新运行 setup.mjs。');
  }

  const apiKey = process.env.WEREAD_API_KEY || saved.apiKey;
  const publishUrl = process.env.WEREAD_STORY_PUBLISH_URL || saved.publishUrl || DEFAULT_PUBLISH_URL;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error(`尚未配置微信读书 API Key。请在本机运行 node <skill-directory>/scripts/setup.mjs，然后在打开的本地页面完成配置。`);
  }
  return { apiKey: apiKey.trim(), publishUrl: normalizePublishUrl(publishUrl) };
}

export async function saveConfiguration(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.trim().length > 4096) {
    throw new Error('微信读书 API Key 无效。');
  }
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ apiKey: apiKey.trim(), publishUrl: DEFAULT_PUBLISH_URL }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return path;
}

function normalizePublishUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') throw new Error();
    return url.href.replace(/\/$/, '');
  } catch {
    throw new Error('发布地址必须是 HTTPS URL。');
  }
}
