---
name: weread-story-publisher
description: Publish an encrypted, animated mobile WeRead annual story from verified reading statistics. Use when a user asks to generate, publish, QR-share, or revoke a WeRead Story.
---

# WeRead Story Publisher

Publish only after the user has approved public sharing. Keep the raw report on the local machine: the bundled script encrypts it before upload and creates a QR code for the animated H5.

## Validate before publishing

- Verify `year`, `focusPercent`, `totalMinutes`, `booksRead`, the top book title/minutes/cover, and 1–4 topics against the authorized source.
- Default identity mode to `name_avatar`; honor explicit `name` or `anonymous` choices. Do not include WeChat IDs, WeRead IDs, raw notes, or the full reading-history export.
- Use a direct HTTPS book-cover image or a same-origin authorized asset. Never use a screenshot of a reader/store page as a cover.
- Keep the fixed six-screen narrative intact unless the user explicitly asks to change the product logic.

Create a minimal UTF-8 JSON payload:

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
  "expiresInDays": 30
}
```

## Publish

The administrator supplies `WEREAD_STORY_PUBLISH_URL` and `WEREAD_STORY_INVITE_CODE` in the controlled execution environment. Never print or persist the invite code.

Run:

```text
node <skill-directory>/scripts/publish-story.mjs <payload-file>
```

The command returns paths, not the secret link itself. Hand the generated QR image to the user and keep the `.url` link private. The `.revoke.json` file is a separate management credential; do not send it to viewers. The default lifetime is 30 days, and `expiresInDays` should only differ when the user explicitly requests it.

Explain that scanning the QR opens the animated mobile Story. The user performs the final WeChat/Moments share. Do not claim that a share succeeded until the user verifies it on a real phone.

## Revoke

When the publisher asks to remove a Story, run:

```text
node <skill-directory>/scripts/revoke-story.mjs <local-.revoke.json-path>
```

Confirm revocation only after the endpoint returns success. Deletion can take a short time to propagate through Cloudflare KV caches, and already saved copies cannot be recalled.

## Privacy wording

Say precisely that the current service stores ciphertext and normally does not receive the fragment key. Do not promise absolute privacy or audited zero knowledge: the site operator controls the JavaScript delivered to browsers, and access metadata remains visible to the hosting platform.
