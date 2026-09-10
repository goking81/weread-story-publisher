# WeRead Story Publisher

将一份经过确认的阅读统计发布为可在微信中打开、滑动并保留动效的移动端 H5。默认有效期为 30 天。阅读报告在本机用 AES-GCM 加密，服务端只保存临时密文、到期时间和撤销哈希；解密密钥只在分享链接的 `#` 片段中，由查看者的浏览器使用。

## 本地启动

```powershell
Copy-Item .env.example .env
# 在 .env 中设置 PUBLIC_BASE_URL 与至少一个长且随机的 PUBLISH_INVITE_CODES
npm install
npm test
npm start
```

本地测试发布（原始 JSON 仅留在本机）：

```powershell
$env:WEREAD_STORY_PUBLISH_URL='http://localhost:3000'
$env:WEREAD_STORY_INVITE_CODE='<PUBLISH_INVITE_CODES 中的一个邀请码>'
node skills/weread-story-publisher/scripts/publish-story.mjs examples/sample-story.json
```

命令只会上传加密信封，并会在本地输出一个二维码 PNG 和一个位于系统临时目录的 `urlFile`（完整 URL 不会直接打印到终端）。完整 URL 带有 `#` 后的解密密钥，任何拿到它的人均可查看故事；不要放到日志、统计平台或公开文档。要撤销，运行：

```powershell
node skills/weread-story-publisher/scripts/revoke-story.mjs '<完整 Story URL>'
```

撤销会立即删除服务端密文。到期后，服务端也会自动删除。

## 部署到自己的服务器

1. 为域名配置 HTTPS，并把 `PUBLIC_BASE_URL` 设为最终的 `https://` 地址，例如 `https://readstory.learnbox.cc`。
2. 将 `.env` 和 `data/` 放在服务器的持久磁盘，不要上传到 GitHub。
3. 在反向代理中把全部请求转发给本服务；保留 `Host` 和 `X-Forwarded-Proto` 请求头。
4. 将 `PUBLISH_INVITE_CODES` 只放在服务器和调用 Skill 的受控环境，绝不放进浏览器代码或 Git。

Docker 部署：

```bash
docker build -t weread-story-publisher .
docker run --env-file .env -v /srv/weread-story/data:/app/data -p 3000:3000 weread-story-publisher
```

## Skill

`skills/weread-story-publisher/` 是可随仓库发布的 Codex Skill。它只在用户明确同意公开分享、且阅读数据已核对后调用发布 API。发布脚本在本地加密，服务端接口拒绝包含明文字段的请求。

ChatGPT 网页端若要直接触发这个 Skill，还需要把发布 API 通过已授权的 MCP/应用工具暴露给网页端；仅把 `SKILL.md` 推到 GitHub 不会自动授予 ChatGPT 对你服务器的调用权限。

## 隐私边界

- 服务端能看到发布时间、到期时间、密文大小、访问 IP 与用户代理，不能从保存内容中读取书名、时长、昵称或头像。
- 链接片段在标准浏览器请求中不会发送给服务端；页面额外设置了 `Referrer-Policy: no-referrer`。但得到完整链接的人仍可查看故事，因此它相当于一张可撤销的“持有即访问”门票。
- 若故事使用远程书封，查看者的浏览器会在解密后请求该图片提供方；生产环境建议把获授权的封面转存到自己的 HTTPS 静态资源域。

## 当前边界

- 已实现：本地加密发布、公开读取与浏览器解密、本地二维码、默认 30 天失效、手动撤销、v0.1 邀请码门槛和移动端动态页面。
- 尚未接入：微信读书真实数据抓取、微信 JS-SDK 分享卡片配置、用户登录和多服务器数据库。
