import { spawnSync } from 'node:child_process';

const nodeMajor = Number(process.versions.node.split('.')[0]);
const hasFfmpeg = commandWorks('ffmpeg', ['-version']);

if (process.argv.includes('--status')) {
  console.log(JSON.stringify({ node: process.versions.node, nodeReady: nodeMajor >= 18, ffmpegReady: hasFfmpeg }, null, 2));
} else if (process.argv.includes('--install-ffmpeg')) {
  if (nodeMajor < 18) throw new Error('需要 Node.js 18+ 才能运行环境检查。请先安装官方 Node.js LTS，并重新打开终端。');
  if (hasFfmpeg) console.log('FFmpeg 已可用。');
  else {
    const installer = findInstaller();
    if (!installer) throw new Error('未找到受支持的本机包管理器。请安装 FFmpeg 后重新运行环境检查。');
    console.log(`正在通过 ${installer.command} 安装 FFmpeg…`);
    const result = spawnSync(installer.command, installer.args, { stdio: 'inherit' });
    const wingetInstalled = process.platform === 'win32' && wingetPackageInstalled();
    if (result.error || (result.status !== 0 && !wingetInstalled)) {
      throw new Error('FFmpeg 安装未完成。请处理包管理器提示后，重新运行此命令。');
    }
    if (!commandWorks('ffmpeg', ['-version']) && process.platform === 'win32') {
      console.log('FFmpeg 已安装；请重新打开终端或 Agent 以刷新 PATH，然后运行 environment.mjs --status 确认。');
      process.exit(0);
    }
    if (!commandWorks('ffmpeg', ['-version'])) throw new Error('FFmpeg 安装后仍不可用。请处理包管理器提示后重试。');
    console.log('FFmpeg 已安装并可用。');
  }
} else {
  console.log('用法：node environment.mjs --status | --install-ffmpeg');
}

function commandWorks(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function wingetPackageInstalled() {
  const result = spawnSync('winget', ['list', '--id', 'Gyan.FFmpeg', '-e'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function findInstaller() {
  if (process.platform === 'win32' && commandWorks('winget', ['--version'])) {
    return { command: 'winget', args: ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements'] };
  }
  if (process.platform === 'darwin' && commandWorks('brew', ['--version'])) return { command: 'brew', args: ['install', 'ffmpeg'] };
  if (process.platform === 'linux' && commandWorks('apt-get', ['--version'])) {
    const prefix = typeof process.getuid === 'function' && process.getuid() !== 0 ? ['sudo'] : [];
    return { command: prefix[0] || 'apt-get', args: prefix.length ? ['apt-get', 'install', '-y', 'ffmpeg'] : ['install', '-y', 'ffmpeg'] };
  }
  return null;
}
