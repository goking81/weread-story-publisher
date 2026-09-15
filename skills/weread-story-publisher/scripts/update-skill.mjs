import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'goking81/weread-story-publisher';
const sourceRoot = 'skills/weread-story-publisher';
const apiBase = (process.env.WEREAD_STORY_UPDATE_API_BASE || 'https://api.github.com').replace(/\/$/, '');
const ref = process.env.WEREAD_STORY_UPDATE_REF || 'main';
const statePath = join(process.env.WEREAD_STORY_CONFIG_DIR || join(homedir(), '.weread-story-publisher'), 'update.json');
const background = process.argv.includes('--background');
const apply = process.argv.includes('--apply') || background;

if (process.argv.includes('--help')) {
  console.log('用法：node update-skill.mjs [--check|--apply|--background]');
  process.exit(0);
}

try {
  if (background && !(await isCheckDue())) {
    report({ checked: false, updated: false, reason: 'not_due' });
    process.exit(0);
  }

  const installed = JSON.parse(await readFile(join(skillRoot, 'package.json'), 'utf8')).version;
  const remote = JSON.parse(await remoteFile('package.json')).version;
  const updateAvailable = compareVersions(remote, installed) > 0;
  await recordCheck();

  if (!updateAvailable || !apply) {
    report({ checked: true, updated: false, installed, available: remote, updateAvailable });
    process.exit(0);
  }

  await installRemoteSkill(remote);
  report({ checked: true, updated: true, installed: remote, previous: installed });
} catch (error) {
  if (background) {
    report({ checked: false, updated: false, reason: 'unavailable' });
    process.exit(0);
  }
  console.error(`Skill 更新失败：${error.message}`);
  process.exit(1);
}

function report(value) {
  console.log(JSON.stringify(value));
}

async function isCheckDue() {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return !Number.isFinite(state.checkedAt) || Date.now() - state.checkedAt >= 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

async function recordCheck() {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ checkedAt: Date.now() }), 'utf8');
}

async function remoteFile(path) {
  const safe = safePath(path);
  const encoded = safe.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${apiBase}/repos/${repository}/contents/${sourceRoot}/${encoded}?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`无法读取更新源（${response.status}）`);
  const data = await response.json();
  if (data.type !== 'file' || typeof data.content !== 'string') throw new Error(`更新源文件无效：${safe}`);
  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

async function remoteDirectory(path) {
  const safe = safePath(path);
  const encoded = safe.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${apiBase}/repos/${repository}/contents/${sourceRoot}/${encoded}?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`无法读取更新目录（${response.status}）`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`更新源目录无效：${safe}`);
  return data.map(entry => entry.name).filter(name => /^[A-Za-z0-9._-]+$/.test(name));
}

async function installRemoteSkill(remoteVersion) {
  const staging = await mkdtemp(join(tmpdir(), 'weread-skill-update-'));
  try {
    const files = ['SKILL.md', 'package.json', 'package-lock.json'];
    for (const directory of ['scripts', 'agents']) {
      for (const name of await remoteDirectory(directory)) files.push(`${directory}/${name}`);
    }
    for (const file of files) {
      const destination = join(staging, safePath(file));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await remoteFile(file), 'utf8');
    }
    const staged = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8')).version;
    if (staged !== remoteVersion) throw new Error('更新包版本不一致');
    await cp(staging, skillRoot, { recursive: true, force: true });
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['ci', '--omit=dev', '--prefix', skillRoot], { stdio: 'ignore', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error('更新后依赖刷新失败');
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function safePath(path) {
  const normalized = path.replace(/\\/g, '/');
  if (!/^(SKILL\.md|package(?:-lock)?\.json|scripts|agents|(scripts|agents)\/[A-Za-z0-9._-]+)$/.test(normalized)) throw new Error('不允许的更新路径');
  return normalized;
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(value => !Number.isInteger(value) || value < 0)) throw new Error('版本号无效');
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
