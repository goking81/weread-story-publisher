# WeRead Story Publisher

将一份经过确认的阅读统计发布为可在微信中打开、滑动并保留动效的移动端 H5。每份报告有不可猜测的短链接、二维码和独立失效时间。

## 本地启动

```bash
cp .env.example .env
# 在 .env 中设置 PUBLIC_BASE_URL 与至少 24 位的 PUBLISH_API_KEY
npm install
npm test
npm start
```

本地测试发布：

```bash
curl -X POST http://localhost:3000/api/stories \
  -H "Authorization: Bearer <PUBLISH_API_KEY>" \
  -H "Content-Type: application/json" \
  --data-binary @examples/sample-story.json
```

返回的 `url` 是公开 Story 地址，`qrUrl` 是同一地址的二维码。删除 `DELETE /api/stories/{slug}` 会立即撤销访问。

## 部署到自己的服务器

1. 为域名配置 HTTPS，并把 `PUBLIC_BASE_URL` 设为最终的 `https://` 地址。
2. 将 `.env` 和 `data/` 放在服务器的持久磁盘，不要上传到 GitHub。
3. 在反向代理中把全部请求转发给本服务；保留 `Host` 和 `X-Forwarded-Proto` 请求头。
4. 将 `PUBLISH_API_KEY` 仅保存在服务端和调用 Skill 的受控环境，绝不放进浏览器代码。

Docker 部署：

```bash
docker build -t weread-story-publisher .
docker run --env-file .env -v /srv/weread-story/data:/app/data -p 3000:3000 weread-story-publisher
```

## Skill

`skills/weread-story-publisher/` 是可随仓库发布的 Codex Skill。它只在用户明确同意公开分享、且阅读数据已核对后调用发布 API。

ChatGPT 网页端若要直接触发这个 Skill，还需要把发布 API 通过已授权的 MCP/应用工具暴露给网页端；仅把 `SKILL.md` 推到 GitHub 不会自动授予 ChatGPT 对你服务器的调用权限。

## 当前边界

- 已实现：创建、公开读取、二维码、到期失效、手动撤销、移动端动态页面。
- 尚未接入：微信读书真实数据抓取、微信 JS-SDK 分享卡片配置、用户登录和多服务器数据库。
