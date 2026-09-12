import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const configDir = await mkdtemp(join(tmpdir(), 'weread-story-config-'));
const inheritedApiKey = process.env.WEREAD_API_KEY;
const inheritedPublishUrl = process.env.WEREAD_STORY_PUBLISH_URL;
delete process.env.WEREAD_API_KEY;
delete process.env.WEREAD_STORY_PUBLISH_URL;
process.env.WEREAD_STORY_CONFIG_DIR = configDir;
const { getConfigPath, loadConfiguration, saveConfiguration } = await import('../skills/weread-story-publisher/scripts/config.mjs');

test('本地配置保存 API Key，环境变量仍可临时覆盖', async () => {
  await saveConfiguration('local-key');
  assert.match(getConfigPath(), /credentials\.json$/);
  assert.deepEqual(await loadConfiguration(), { apiKey: 'local-key', publishUrl: 'https://readstory.learnbox.cc' });
  process.env.WEREAD_API_KEY = 'override-key';
  process.env.WEREAD_STORY_PUBLISH_URL = 'https://example.com/';
  assert.deepEqual(await loadConfiguration(), { apiKey: 'override-key', publishUrl: 'https://example.com' });
  delete process.env.WEREAD_API_KEY;
  delete process.env.WEREAD_STORY_PUBLISH_URL;
  await rm(configDir, { recursive: true, force: true });
  if (inheritedApiKey === undefined) delete process.env.WEREAD_API_KEY;
  else process.env.WEREAD_API_KEY = inheritedApiKey;
  if (inheritedPublishUrl === undefined) delete process.env.WEREAD_STORY_PUBLISH_URL;
  else process.env.WEREAD_STORY_PUBLISH_URL = inheritedPublishUrl;
});
