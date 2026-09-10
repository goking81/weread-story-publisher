---
name: weread-story-publisher
description: Publish an end-to-end encrypted, mobile WeRead Story link from verified reading statistics. Use after the user has approved public sharing and selected a privacy mode.
---

# WeRead Story Publisher

Create a public mobile Story only from verified reading data and an explicit user choice to publish. The raw report remains on the user's machine: it is encrypted locally before upload and decrypts only in the viewing browser.

## Before publishing

- Confirm the report year, reading duration, book count, hero book, and topics from the data source.
- Ask for a publish decision if the user has not already made one. The default identity mode is `name_avatar`; allow `name` and `anonymous`.
- Never include a WeChat ID, WeRead user ID, raw notes, or a full reading-history export in the Story payload.
- Use an HTTPS cover image URL from the book source when available. Do not send screenshots of a storefront or reader UI as a book cover.
- Treat the final Story URL as a secret: its `#...` fragment contains the decryption key. Do not put that URL in analytics, issue trackers, terminal transcripts, or a public document.

## Publish

The service URL and v0.1 beta invite code are supplied through `WEREAD_STORY_PUBLISH_URL` and `WEREAD_STORY_INVITE_CODE`. The default life span is 30 days; set `expiresInDays` only when the user explicitly requests a different duration.

1. Write a minimal JSON payload matching `examples/sample-story.json`.
2. Run `node skills/weread-story-publisher/scripts/publish-story.mjs <payload-file>`.
3. The script creates a local QR image and writes the full Story URL to a temporary `urlFile` rather than printing it. Read that file only in the controlled local session, then relay the link privately to the user. Explain that opening it in WeChat preserves the H5 motion; the user still chooses the final Moments post.

The publisher encrypts the complete payload using AES-GCM locally. The service receives only a ciphertext envelope, an expiry timestamp, and a one-way revocation hash. The key is appended after `#` in the final URL, so browsers do not send it to the service.

## Revoke

When the user asks to remove a published story, run `node skills/weread-story-publisher/scripts/revoke-story.mjs <full-story-url>`. Confirm only after the endpoint returns success. The local revoke script derives the credential from the URL fragment; do not send the full URL anywhere else.

The bundled publisher only talks to the configured service. It must not print or save the invite code, raw report, or final secret URL in a project file.
