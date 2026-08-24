---
name: Grafana dashboard data contract
description: External Grafana dashboard structure and the important mapping limits when using it for balance alerts
---

The linked Grafana dashboard returns organization detail rows with hierarchy, FinanceAccountId, UsesOrgBalance, and CalculatedBalance. Its consumption metrics are separate time-series panels parameterized by one OrganizationName, not columns on the organization detail result.

**Why:** The alert system needs per-organization balance, long-term/recent consumption, and day-over-day consumption together. Treating the dashboard detail result as if it already contained all of those metrics would silently classify incomplete records.

**How to apply:** When integrating or validating this dashboard, distinguish expected sub-organization FinanceAccountId gaps from main-organization gaps, preserve the Main/Sub and 0/1 balance-mode categories, and explicitly join or query the separate consumption panels before calculating alert severity.

**Live total timing:** The dashboard's calculated hierarchy `TotalBalance` is live and can change between consecutive requests. Compare it against the app from the same refresh window, and render the study's live balance without compact rounding.

**Why:** A static expected number can look like a mismatch even when both systems are reading the same moving balance source.

**How to apply:** Use the Grafana summary procedure as the source of truth for operational balances and expose a full precision, separator-formatted value in any direct comparison view.

**Hierarchy history source:** Grafana’s “Daily Balance Summary” panel does not aggregate child snapshot rows. It reads the selected main organization’s `BalanceHistory-Daily` row and calculates the historical roll-up as `TotalUserBalance + TotalOrganizationBalance`.

**Why:** Selecting only a parent’s user or organization component produced AlRajhi’s small `205,302` value instead of the Grafana roll-up in the billions; querying child IDs did not recover their daily snapshots.

**How to apply:** Mirror this main-row combined-balance calculation for daily history, consumption, deltas, and rates. Keep child records for the explanatory child-balance UI, not as required contributors to the panel’s daily series.

**Daily interval validity:** A daily consumption delta is valid only when its complete hierarchy snapshots are exactly one calendar day apart.

**Why:** A gap between retained snapshots turns a multi-day balance drop into an overstated single-day rate.

**How to apply:** Filter incomplete hierarchy dates before calculating the lag, then exclude any remaining lag pair whose dates are not adjacent from all rates, daily deltas, and forecast logic. If retained history is fragmented, calculate a forecast only from the most recent contiguous run; never combine separate runs to meet a coverage threshold.

**Interval validity:** The combined main-row series must still use only exactly consecutive daily points for rate and forecast windows.

**Why:** A gap between retained snapshots turns a multi-day balance drop into an overstated one-day rate even when the source formula is correct.

**How to apply:** Keep all Grafana daily rows visible in the study, but exclude gap-boundary pairs from the latest contiguous rate run and return an unavailable estimate if the remaining run is too short.

**Organization names:** Grafana organization names can contain invisible leading or trailing whitespace (for example, `" ANB"`).

**Why:** The dashboard renders the label as ANB, but an exact untrimmed lookup fails and incorrectly reports that the organization is absent.

**How to apply:** Trim Grafana names at the API boundary and use trimmed comparisons when resolving a request back to the Grafana detail rows.