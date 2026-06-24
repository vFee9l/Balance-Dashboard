---
name: OTP library type fix
description: The `type` property is not in OTPVerifyOptions or generateURI options — omit it
---

## Rule

Do NOT pass `type: "totp"` to `verify()` or `generateURI()` from the OTP library used in this project. The TypeScript types do not include it and it causes `tsc` errors.

**Why:** The library defaults to TOTP; specifying it explicitly causes a TS2353 "Object literal may only specify known properties" error. This was a pre-existing bug that surfaced during strict typecheck runs.

**How to apply:** Use `verify({ token, secret })` and `generateURI({ label, issuer, secret })` without `type`.
