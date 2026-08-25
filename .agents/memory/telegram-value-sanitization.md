---
name: Telegram value sanitization
description: Prevent invisible Unicode in broadcast channel IDs and bot tokens from causing Telegram failures.
---

Telegram broadcast channel IDs and bot tokens must have invisible Unicode characters removed before they are persisted and before they are used.

**Why:** Copy/paste can add a zero-width character that normal whitespace trimming does not remove. Telegram then receives a different `chat_id` and rejects an otherwise correct request.

**How to apply:** Keep write-time sanitization, read/send-time sanitization, and the idempotent stored-settings repair. Safe diagnostics may log the normalized Channel ID and its UTF-8 hex, but never the bot token.