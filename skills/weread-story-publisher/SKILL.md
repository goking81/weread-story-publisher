---
name: weread-story-publisher
description: Generate, publish, QR-share, or revoke an encrypted animated annual Story from a user's authorized WeRead statistics.
---

# WeRead Story Publisher

Read the user's authorized annual statistics, prepare the fixed six-screen Story, and publish only after the user approves the exact summary and public share card. The scripts keep the API key and raw response local, encrypt the report before upload, and create a QR code for the animated H5.

## Portability

This is a portable local Skill: the required runtime is Node.js 18+ plus the files in this directory. Codex-only UI metadata lives in `agents/openai.yaml` and is optional. Other agents should import the directory or a package containing `SKILL.md`, `scripts/`, `package.json`, and `package-lock.json`; do not copy API keys, generated reports, QR images, or revoke credentials into the package.

## First use: local configuration page

The local environment needs Node.js 18+. On the first request, guide the user to start the local setup page:

```text
node <skill-directory>/scripts/setup.mjs
```

It prints a `http://127.0.0.1:<port>` URL. The user opens that local page and enters their own WeRead API Key there. The page saves it only in the user's local configuration directory; it never sends the key to this Skill's publisher or to chat. Do not ask the user to paste a Key into conversation, terminal output, or a remote web page. Use `setup.mjs --status` to check whether the local configuration is ready without exposing the Key.

`WEREAD_API_KEY` and `WEREAD_STORY_PUBLISH_URL` remain optional environment-variable overrides for advanced users and managed Agent hosts. The default publisher is `https://readstory.learnbox.cc`.

Install the Skill's one runtime dependency once when `node_modules` is absent:

```text
npm ci --omit=dev --prefix <skill-directory>
```

If the API key is absent, stop and direct the user to the local setup page. Do not ask them to paste it into chat.

## Prepare from WeRead

Ask for the report year and one identity choice: `昵称与头像` (recommended), `仅昵称`, or `匿名`. A remote avatar is public and its host can observe image requests, so obtain approval before using it. Then run one of:

```text
node <skill-directory>/scripts/prepare-story.mjs --year 2026 --identity anonymous --output <local-json>
node <skill-directory>/scripts/prepare-story.mjs --year 2026 --identity name --nickname <name> --output <local-json>
node <skill-directory>/scripts/prepare-story.mjs --year 2026 --identity name_avatar --nickname <name> --avatar-url <https-url> --output <local-json>
```

The script calls only the annual reading-statistics endpoint, treats all duration fields as seconds, selects the longest-ranked electronic book with a real cover, and derives the focus percentage. It does not read or upload notes, highlights, WeChat IDs, WeRead IDs, or the full reading history.

## Validate before publishing

- Verify `year`, `focusPercent`, `totalMinutes`, `booksRead`, the top book title/minutes/cover, and 1–4 topics against the authorized source.
- Default identity mode to `name_avatar`; honor explicit `name` or `anonymous` choices. Do not include WeChat IDs, WeRead IDs, raw notes, or the full reading-history export.
- Use a direct HTTPS book-cover image or a same-origin authorized asset. Never use a screenshot of a reader/store page as a cover.
- The share-card title, short description, and image URL are intentionally public so WeChat can read them without the fragment key. Tell the user this narrow exception; keep the full report encrypted.
- Keep the fixed six-screen narrative intact unless the user explicitly asks to change the product logic.

The prepared UTF-8 JSON has this shape:

```json
{
  "identity": { "mode": "name_avatar", "nickname": "阅读者", "avatarUrl": "https://example.com/avatar.jpg" },
  "report": {
    "year": 2026,
    "focusPercent": 71,
    "totalMinutes": 2096,
    "booksRead": 9,
    "topBook": { "title": "历史深处的民国（全集）", "minutes": 1482, "coverUrl": "https://example.com/cover.jpg" },
    "topics": ["历史", "人物传记", "年代小说", "文学"]
  },
  "share": {
    "title": "2026，我一直在往历史深处走",
    "description": "34小时56分，71%的阅读时间留给了同一本书",
    "imageUrl": "https://example.com/cover.jpg"
  },
  "expiresInDays": 30
}
```

Show the user the year, total reading duration, number of books, hero book and duration, focus percentage, topics, identity mode, and the public `share` title/description/image. Stop before publishing until they approve this summary.

## Publish

Set `WEREAD_STORY_PUBLISH_URL` to the public publisher endpoint. Publishing is open to the public; the Worker still enforces a per-network hourly limit. Do not claim that open publishing eliminates the need to review the public share card.

Run:

```text
node <skill-directory>/scripts/publish-story.mjs <payload-file>
```

The command returns paths, not the secret link itself. Hand the generated QR image to the user and keep the `.url` link private. The `.revoke.json` file is a separate management credential; do not send it to viewers. The default lifetime is 30 days, and `expiresInDays` should only differ when the user explicitly requests it.

Explain that scanning the QR opens the animated mobile Story. The user performs the final WeChat/Moments share. Do not claim that a share succeeded until the user verifies it on a real phone.

The publisher derives a stronger first-person share title from the year and primary topic, plus a short numerical description and the hero-book cover. A caller may provide a reviewed `share` object to override those three public fields.

## Revoke

When the publisher asks to remove a Story, run:

```text
node <skill-directory>/scripts/revoke-story.mjs <local-.revoke.json-path>
```

Confirm revocation only after the endpoint returns success. Deletion can take a short time to propagate through Cloudflare KV caches, and already saved copies cannot be recalled.

## Privacy wording

Say precisely that the current service stores ciphertext and normally does not receive the fragment key. Do not promise absolute privacy or audited zero knowledge: the site operator controls the JavaScript delivered to browsers, and access metadata remains visible to the hosting platform.
