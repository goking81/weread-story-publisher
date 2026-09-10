---
name: weread-story-publisher
description: Publish a tokenized, mobile WeRead Story link from verified reading statistics. Use after the user has approved public sharing and selected a privacy mode.
---

# WeRead Story Publisher

Create a public mobile Story only from verified reading data and an explicit user choice to publish.

## Before publishing

- Confirm the report year, reading duration, book count, hero book, and topics from the data source.
- Ask for a publish decision if the user has not already made one. The default identity mode is `name_avatar`; allow `name` and `anonymous`.
- Never send a WeChat ID, WeRead user ID, raw notes, or a full reading-history export to the public endpoint.
- Use an HTTPS cover image URL from the book source when available. Do not send screenshots of a storefront or reader UI as a book cover.

## Publish

The service URL and API key are supplied through `WEREAD_STORY_PUBLISH_URL` and `WEREAD_STORY_PUBLISH_API_KEY`.

1. Write a minimal JSON payload matching `examples/sample-story.json`.
2. Run `node skills/weread-story-publisher/scripts/publish-story.mjs <payload-file>`.
3. Return the resulting story URL and QR URL to the user. Explain that opening the link in WeChat preserves the H5 motion; the user still chooses the final Moments post.

## Revoke

When the user asks to remove a published story, send `DELETE /api/stories/{slug}` with the same bearer key. Confirm only after the endpoint returns success.

The bundled publisher only talks to the configured service. It must not print the bearer key or save it into a project file.
