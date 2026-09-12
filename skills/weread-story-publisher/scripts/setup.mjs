import { createServer } from 'node:http';
import { getConfigPath, saveConfiguration } from './config.mjs';

if (process.argv.includes('--status')) {
  const configured = await hasLocalConfiguration();
  console.log(JSON.stringify({ configured, configPath: getConfigPath() }, null, 2));
} else {
  await startSetup();
}

async function hasLocalConfiguration() {
  try {
    const { loadConfiguration } = await import('./config.mjs');
    await loadConfiguration();
    return true;
  } catch {
    return false;
  }
}

async function startSetup() {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/') return html(response);
    if (request.method === 'POST' && request.url === '/configure') return configure(request, response, server);
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  console.log(`请在本机浏览器打开：http://127.0.0.1:${port}`);
  console.log('此页面只运行在本机；请自行在页面中输入 API Key，不要把 Key 发到聊天中。');
}

async function configure(request, response, server) {
  try {
    const body = await readJson(request);
    await saveConfiguration(body.apiKey);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true }));
    server.close();
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('请求内容过长。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('请求格式无效。'); }
}

function html(response) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'"
  });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>配置微信读书</title><style>body{margin:0;background:#f3efe6;color:#14223a;font:16px system-ui,-apple-system,"Microsoft YaHei",sans-serif}.card{max-width:480px;margin:12vh auto;padding:36px;background:#fffaf0;box-shadow:0 12px 40px #14223a20}h1{font:600 32px Georgia,"Songti SC",serif;margin:0 0 12px}p{line-height:1.7;color:#516078}label{display:block;margin:28px 0 8px;font-weight:600}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #b8aa8c;background:#fff;font:inherit}button{margin-top:22px;padding:13px 20px;border:0;background:#14223a;color:#fff;font:inherit;cursor:pointer}.note{font-size:13px;color:#69758a}.ok{color:#17663d}</style><main class="card"><p class="note">WE READ STORY</p><h1>配置您的微信读书</h1><p>此页面只运行在您的电脑上。API Key 只保存到本机配置文件，不会上传至 readstory.learnbox.cc，也不会发送到聊天记录。</p><form id="form"><label for="key">微信读书 API Key</label><input id="key" name="key" type="password" autocomplete="off" required><p class="note">请从您已授权的微信读书 API 获取 Key；不要填写微信密码、短信验证码或支付信息。</p><button>安全保存到本机</button><p id="message" class="note"></p></form></main><script>document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const message=document.querySelector('#message');message.textContent='正在保存…';const r=await fetch('/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:document.querySelector('#key').value})});const d=await r.json();message.textContent=d.ok?'已保存。可以关闭此页面并回到 Agent 生成阅读故事。':d.error;message.className=d.ok?'ok':'note'});</script>`);
}
