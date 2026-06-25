---
name: otplib v13 functional API
description: otplib@13 removed the authenticator/totp objects; all TOTP ops use named functional exports
---

## Rule
Import from the functional API — `authenticator` and the `totp` instance object do NOT exist in otplib v13.

```ts
import { generateSecret, generateURI, verifySync } from "otplib";

const secret = generateSecret();                       // no args (or options object)
const uri = generateURI({ issuer, label, secret });    // object arg, not positional
const result = verifySync({ token, secret });           // result.valid (not result.isValid)
```

**Why:** The package was restructured into `@otplib/*` scoped packages in v13. The `authenticator` singleton and `.keyuri()` method from v12 are gone. The functional API is the new primary interface.

**How to apply:** Any time you write TOTP code against otplib in this project, use the functional imports above. Do not use `authenticator`, `totp`, or `hotp` as named imports — they are not exported from the main `otplib` package in v13.
