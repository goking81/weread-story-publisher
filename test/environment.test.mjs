import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);

test('环境检查以 JSON 报告 Node 与 FFmpeg 状态', async () => {
  const { stdout } = await run(process.execPath, ['skills/weread-story-publisher/scripts/environment.mjs', '--status']);
  const status = JSON.parse(stdout);
  assert.equal(status.node, process.versions.node);
  assert.equal(status.nodeReady, true);
  assert.equal(typeof status.ffmpegReady, 'boolean');
});
