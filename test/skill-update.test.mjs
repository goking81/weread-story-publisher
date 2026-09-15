import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const updater = 'skills/weread-story-publisher/scripts/update-skill.mjs';

test('后台更新仅在有更高版本时替换受允许的 Skill 文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'weread-update-'));
  const config = await mkdtemp(join(tmpdir(), 'weread-update-config-'));
  const skill = join(root, 'skill');
  await mkdir(join(skill, 'scripts'), { recursive: true });
  await mkdir(join(skill, 'agents'), { recursive: true });
  await writeFile(join(skill, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  await writeFile(join(skill, 'package-lock.json'), JSON.stringify({ name: 'test', lockfileVersion: 3, packages: { '': { name: 'test', version: '0.1.0' } } }));
  await writeFile(join(skill, 'SKILL.md'), 'old');
  await writeFile(join(skill, 'scripts', 'update-skill.mjs'), await readFile(updater));
  const remote = {
    'package.json': JSON.stringify({ name: 'test', version: '0.1.1', dependencies: {} }),
    'package-lock.json': JSON.stringify({ name: 'test', version: '0.1.1', lockfileVersion: 3, packages: { '': { name: 'test', version: '0.1.1' } } }),
    'SKILL.md': 'new',
    'scripts/example.mjs': 'export const value = 1;',
    'agents/openai.yaml': 'interface: {}\n'
  };
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.split('/contents/')[1].split('/').slice(2).join('/'));
    if (path === 'scripts' || path === 'agents') {
      const name = path === 'scripts' ? 'example.mjs' : 'openai.yaml';
      response.end(JSON.stringify([{ name }]));
      return;
    }
    const content = remote[path];
    if (!content) { response.statusCode = 404; response.end(); return; }
    response.end(JSON.stringify({ type: 'file', content: Buffer.from(content).toString('base64') }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const api = `http://127.0.0.1:${server.address().port}`;
  const { stdout } = await run(process.execPath, [join(skill, 'scripts', 'update-skill.mjs'), '--background'], { env: { ...process.env, WEREAD_STORY_UPDATE_API_BASE: api, WEREAD_STORY_CONFIG_DIR: config } });
  assert.equal(JSON.parse(stdout).updated, true);
  assert.equal(JSON.parse(await readFile(join(skill, 'package.json'), 'utf8')).version, '0.1.1');
  assert.equal(await readFile(join(skill, 'SKILL.md'), 'utf8'), 'new');
});
