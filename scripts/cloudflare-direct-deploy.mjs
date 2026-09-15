import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 保留旧入口，但统一使用 Wrangler 的登录、资源上传和部署流程，不再读取旧明文凭据。
console.log('此兼容入口现在使用官方 Wrangler 部署；请优先执行 npm run worker:deploy。');
const cli = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'deploy', '--keep-vars', ...process.argv.slice(2)
], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
cli.on('error', error => { console.error(error.message); process.exitCode = 1; });
cli.on('exit', code => { process.exitCode = code ?? 1; });
