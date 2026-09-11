# WeRead Story Publisher

把经过用户确认的微信读书年度统计，发布成可在手机和微信中打开、上下滑动并保留动效的 H5。线上地址为 `https://readstory.learnbox.cc`，每份故事默认保留 30 天。

## 已实现

- 6 屏移动端动态阅读故事与真实书封展示
- 本机 AES-GCM 加密后发布；分享链接的 `#` 片段携带解密密钥
- 为微信卡片单独提供公开的标题、短摘要和封面地址；完整报告仍为密文
- Cloudflare Worker、KV 临时存储、每 IP 每小时 5 次发布限制
- 30 天到期、独立撤销凭据、二维码与私密链接文件
- 三种署名方式：昵称与头像（默认）、仅昵称、匿名
- 可安装的 Codex Skill：`skills/weread-story-publisher/`

尚未接入微信读书 API、微信 JS-SDK 分享卡片和普通用户自助登录。当前 v0.1 由受控的邀请码保护发布接口。

## 使用发布脚本

准备一份与 `examples/sample-story.json` 同结构的 JSON，然后运行：

```powershell
$env:WEREAD_STORY_PUBLISH_URL='https://readstory.learnbox.cc'
$env:WEREAD_STORY_INVITE_CODE='<管理员提供的邀请码>'
node skills/weread-story-publisher/scripts/publish-story.mjs examples/sample-story.json
```

脚本上传的只有密文，并生成三个本地文件：

- `*.qr.png`：手机扫码打开动态故事
- 系统临时目录中的 `*.url`：含解密密钥的完整分享链接
- `*.url.revoke.json`：仅发布者保管的撤销凭据

完整链接和撤销文件都不应进入 Git、日志、统计平台或公开文档。撤销时运行：

```powershell
node skills/weread-story-publisher/scripts/revoke-story.mjs '<本地 .revoke.json 文件路径>'
```

## 本地验证

```powershell
npm ci
npm test
npm start
```

Cloudflare Worker 本地预览：

```powershell
npx wrangler dev
```

## Cloudflare 部署

项目使用 Worker 静态资源、KV 和 Durable Object，不需要购买服务器，也不依赖 Supabase。

1. 创建名为 `WEREAD_STORIES` 的 KV，并把 ID 写入 `wrangler.jsonc`。
2. 设置 Worker secrets：`PUBLISH_INVITE_CODES` 与 `RATE_LIMIT_SALT`。
3. 运行 `npm test` 和 `npx wrangler deploy`，或在 Cloudflare 中连接本 GitHub 仓库。
4. 将 Custom Domain 设为 `readstory.learnbox.cc`；Cloudflare 自动管理 DNS 和 HTTPS 证书。

`scripts/configure-secrets.mjs` 仅供站点管理员初始化或轮换 secrets；它会把值保存到已被 Git 忽略的 `.local-publish.json`，不会打印密钥。

## 隐私边界

- 当前实现上传并保存的是密文。常规请求中，服务端看不到链接 `#` 后的密钥，因此不能直接从 KV 里的内容读出昵称、书名、时长或头像。
- 微信必须在解密前抓取卡片，因此分享标题、短摘要和封面地址会明文保存；它们应只包含用户已同意公开的最少信息。
- 站点仍能看到访问 IP、时间、密文大小和浏览器信息；完整分享链接持有者也能查看故事。
- 这不是经过独立审计的“零知识”系统：站点运营者控制前端代码，若前端被恶意修改或站点被攻破，理论上仍可能泄露解密后的数据。敏感笔记、微信 ID、完整阅读历史均不应放入故事。
- 到期或撤销会删除云端密文，但 Cloudflare KV 的边缘缓存可能短暂延迟；接收者已经保存的内容无法远程收回。
- 远程头像或书封会让图片提供方收到图片请求。正式版宜使用获授权、同域托管的封面资源。

## Skill 的作用范围

Skill 负责校验最小数据、按用户选择处理署名、本机加密、发布、生成二维码和撤销文件。它不会自行绕过微信读书授权，也不会把邀请码或完整分享链接提交到 GitHub。ChatGPT 网页端若要直接调用，还需要一个已授权的本地工具或 MCP 执行这些脚本。
