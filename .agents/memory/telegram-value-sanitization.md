---
name: Telegram value sanitization
description: Prevent invisible Unicode in broadcast channel IDs and bot tokens from causing Telegram failures.
---

Telegram broadcast credentials and interactive bot tokens must have invisible Unicode characters removed before they are persisted and before they are used.

**Why:** Copy/paste can add a zero-width character that normal whitespace trimming does not remove. Telegram then receives a different `chat_id` and rejects an otherwise correct request.

**How to apply:** Keep write-time sanitization, read/send-time sanitization, and idempotent stored-settings repair for both integrations. Safe interactive-bot diagnostics may log only token length plus first/last four characters; never log a full token.