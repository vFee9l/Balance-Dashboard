---
name: Google Sheets alert routing
description: Per-client contact lookup from Google Sheet by Finance ID; new severity-based email/SMS routing rules; DB contacts as fallback
---

## Rules

- Sheet URL stored in `settings.googleSheetUrl`. Sheet must be publicly shared ("Anyone with link can view").
- Sheet is fetched as CSV (`/export?format=csv`). Row 0 is header (skipped). Finance ID is **column E (index 4)**.
- Column layout (0-based): C=2 AM name, D=3 CSS name, E=4 Finance ID, F=5 AM mobiles, G=6 AM emails, H=7 CSS mobiles, I=8 CSS emails, J=9 Mgr mobiles, K=10 Mgr emails, L=11 MD mobiles, M=12 MD emails. Multiple values per cell = comma-separated.
- Finance ID from Grafana SQL: `o.FinanceAccountId AS finance_id` in query A and query E (direct balance).

## Severity routing

| Severity  | SMS to              | Email To       | Email CC              |
|-----------|---------------------|----------------|-----------------------|
| Warning   | AM + CSS            | AM + CSS       | Managers              |
| Critical  | AM + CSS + Managers | Managers       | AM + CSS + MD         |
| Emergency | All                 | MD             | Managers + AM + CSS   |

**Why:** User requirement — each client has specific AM/CSS assigned; sheet is per-client, DB contacts are global fallback.

**How to apply:** `resolveContacts(financeId, severity)` in `runAlertChecks()`. If no sheet row matches the Finance ID, falls back to DB contacts with the same routing rules.
