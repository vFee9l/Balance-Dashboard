---
name: Grafana dashboard data contract
description: External Grafana dashboard structure and the important mapping limits when using it for balance alerts
---

The linked Grafana dashboard returns organization detail rows with hierarchy, FinanceAccountId, UsesOrgBalance, and CalculatedBalance. Its consumption metrics are separate time-series panels parameterized by one OrganizationName, not columns on the organization detail result.

**Why:** The alert system needs per-organization balance, long-term/recent consumption, and day-over-day consumption together. Treating the dashboard detail result as if it already contained all of those metrics would silently classify incomplete records.

**How to apply:** When integrating or validating this dashboard, distinguish expected sub-organization FinanceAccountId gaps from main-organization gaps, preserve the Main/Sub and 0/1 balance-mode categories, and explicitly join or query the separate consumption panels before calculating alert severity.