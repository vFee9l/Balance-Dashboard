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

**Hierarchy history completeness:** A live main-organization total can include direct-balance children that have no corresponding daily snapshot history. Do not calculate a forecast from only the parent or an incomplete subset.

**Why:** Combining a rolled-up live total with parent-only consumption produces a materially false days-remaining estimate.

**How to apply:** Aggregate daily values by all records rolling up to the main organization and their individual balance modes. Exclude partial hierarchy days from the rate, report the coverage limitation, and show no forecast when no complete history remains.

**Daily interval validity:** A daily consumption delta is valid only when its complete hierarchy snapshots are exactly one calendar day apart.

**Why:** A gap between retained snapshots turns a multi-day balance drop into an overstated single-day rate.

**How to apply:** Filter incomplete hierarchy dates before calculating the lag, then exclude any remaining lag pair whose dates are not adjacent from all rates, daily deltas, and forecast logic. If retained history is fragmented, calculate a forecast only from the most recent contiguous run; never combine separate runs to meet a coverage threshold.

**Historical contributor selection:** Use the same hierarchy records that make up the current calculated total. A main parent with a zero calculated balance is not a required historical contributor when its child records supply the live total.

**Why:** Counting that zero-balance parent as an expected snapshot makes valid child history look incomplete, which hid AlRajhi's daily balance data and suppressed usable rates.

**How to apply:** Deduplicate each organization's daily snapshot before aggregating by date, retain all aggregated rows for the study display with coverage metadata, and use only complete consecutive intervals from the latest run for rates and forecasts.