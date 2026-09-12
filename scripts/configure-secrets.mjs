import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// 仅管理员部署时运行；密钥文件已加入 Git 与 Docker 忽略规则。
const path = resolve('.local-publish.json');
let secrets;
try { secrets = JSON.parse(await readFile(path, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  secrets = { RATE_LIMIT_SALT: randomBytes(32).toString('base64url') };
  await writeFile(path, JSON.stringify(secrets), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}
delete secrets.PUBLISH_INVITE_CODES;
const cli = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk'], {
  env: { ...process.env, XDG_CONFIG_HOME: resolve('.wrangler-config') },
  stdio: ['pipe', 'inherit', 'inherit']
});
cli.stdin.end(JSON.stringify(secrets));
cli.on('error', error => { console.error(error.message); process.exitCode = 1; });
cli.on('exit', code => { process.exitCode = code || 0; });
