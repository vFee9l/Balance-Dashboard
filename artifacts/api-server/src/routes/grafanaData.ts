export interface GrafanaFrame {
  schema: {
    fields: Array<{ name: string; type: string }>;
  };
  data: {
    values: unknown[][];
  };
}

export interface ClientBalanceData {
  metric: string;
  remainingBalance: number;
  dailyConsumption: number;
  recentDailyConsumption: number;
  yesterdayConsumption: number;
  dayBeforeConsumption: number | null;
  financeId: string | null;
  lastUpdated: string;
}

export interface DashboardOrganization {
  metric: string;
  financeId: string | null;
  usesOrgBalance: boolean;
  remainingBalance: number;
}

export interface OrganizationStudyPoint {
  date: string;
  balance: number;
  consumption: number;
}

export interface OrganizationChildBalance {
  organizationId: string;
  metric: string;
  financeId: string | null;
  parentOrganizationId: string | null;
  organizationLevel: string;
  usesOrgBalance: boolean;
  remainingBalance: number;
}

export interface OrganizationStudyData {
  metric: string;
  financeId: string | null;
  usesOrgBalance: boolean;
  remainingBalance: number;
  children: OrganizationChildBalance[];
  dailyHistory: OrganizationStudyPoint[];
  averageDailyConsumption: number;
  rateWindowDays: number;
  coverageDays: number;
  daysRemaining: number;
  severity: string;
  rateBasis: string;
  dataQuality: string[];
  lastUpdated: string;
}

interface RawStudyPoint {
  point: OrganizationStudyPoint;
  hasCompleteHierarchy: boolean;
}

export function frameRows(frames: GrafanaFrame[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const rowCount = Math.max(0, ...values.map((value) => Array.isArray(value) ? value.length : 0));
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const row: Record<string, unknown> = {};
      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
        row[fields[fieldIndex].name] = values[fieldIndex]?.[rowIndex] ?? null;
      }
      rows.push(row);
    }
  }
  return rows;
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === "" ? null : text;
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function organisationFromRow(row: Record<string, unknown>): DashboardOrganization | null {
  const metric = stringValue(row.metric);
  if (!metric) return null;
  return {
    metric,
    financeId: stringValue(row.finance_id),
    usesOrgBalance: numberValue(row.uses_org_balance) === 1,
    remainingBalance: numberValue(row.Remaining_Balance),
  };
}

function extractFrameMap(frames: GrafanaFrame[], metricField: string, valueField: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const metricIdx = fields.findIndex((field) => field.name === metricField);
    const valueIdx = fields.findIndex((field) => field.name === valueField);
    if (metricIdx === -1 || valueIdx === -1) continue;
    const metrics = (values[metricIdx] ?? []) as unknown[];
    const vals = (values[valueIdx] ?? []) as unknown[];
    for (let i = 0; i < metrics.length; i++) {
      const metric = stringValue(metrics[i]);
      if (metric && !map.has(metric)) map.set(metric, numberValue(vals[i]));
    }
  }
  return map;
}

function extractStringFrameMap(frames: GrafanaFrame[], metricField: string, valueField: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const metricIdx = fields.findIndex((field) => field.name === metricField);
    const valueIdx = fields.findIndex((field) => field.name === valueField);
    if (metricIdx === -1 || valueIdx === -1) continue;
    const metrics = (values[metricIdx] ?? []) as unknown[];
    const vals = (values[valueIdx] ?? []) as unknown[];
    for (let i = 0; i < metrics.length; i++) {
      const metric = stringValue(metrics[i]);
      const value = stringValue(vals[i]);
      if (metric && value && !map.has(metric)) map.set(metric, value);
    }
  }
  return map;
}

export function parseOrganizationChildren(frames: GrafanaFrame[]): OrganizationChildBalance[] {
  return frameRows(frames)
    .map((row): OrganizationChildBalance | null => {
      const organizationId = stringValue(row.organization_id);
      const metric = stringValue(row.metric);
      if (!organizationId || !metric) return null;
      return {
        organizationId,
        metric,
        financeId: stringValue(row.finance_id),
        parentOrganizationId: stringValue(row.parent_organization_id),
        organizationLevel: stringValue(row.organization_level) ?? "child",
        usesOrgBalance: numberValue(row.uses_org_balance) === 1,
        remainingBalance: numberValue(row.Remaining_Balance),
      };
    })
    .filter((child): child is OrganizationChildBalance => child !== null)
    .sort((a, b) => {
      const levelOrder = a.organizationLevel.localeCompare(b.organizationLevel);
      return levelOrder || a.metric.localeCompare(b.metric);
    });
}

/**
 * Convert the two Grafana monitoring panels into alert targets.
 *
 * The balance panel is the source of the target set. Consumption panels may
 * contain child organizations while the calculated summary panel only emits
 * main organizations; iterating balanceMap is what prevents child alerts.
 */
export function parseFramesToBalances(
  balanceFrames: GrafanaFrame[],
  consumptionFrames: GrafanaFrame[],
  recentConsumptionFrames: GrafanaFrame[],
  dayOverDayFrames: GrafanaFrame[],
  fetchedAt: string,
): ClientBalanceData[] {
  const balanceMap = extractFrameMap(balanceFrames, "metric", "Remaining_Balance");
  const financeIdMap = extractStringFrameMap(balanceFrames, "metric", "finance_id");
  const consumptionMap = extractFrameMap(consumptionFrames, "metric", "Avg_Daily_Consumption");
  const recentConsumptionMap = extractFrameMap(recentConsumptionFrames, "metric", "Avg_Daily_Consumption_Recent");
  const yesterdayMap = extractFrameMap(dayOverDayFrames, "metric", "yesterday_consumption");
  const dayBeforeMap = extractFrameMap(dayOverDayFrames, "metric", "day_before_consumption");

  const result: ClientBalanceData[] = [];
  for (const [metric, remainingBalance] of balanceMap.entries()) {
    const dailyConsumption = consumptionMap.get(metric) ?? 0;
    const yesterdayConsumption = yesterdayMap.get(metric) ?? 0;
    const dayBeforeRaw = dayBeforeMap.get(metric);
    const dayBeforeConsumption = dayBeforeRaw !== undefined ? dayBeforeRaw : null;
    const rawRecent = recentConsumptionMap.get(metric) ?? 0;
    const recentDailyConsumption = rawRecent > 0
      ? rawRecent
      : (dailyConsumption === 0 && yesterdayConsumption > 0 ? yesterdayConsumption : 0);

    result.push({
      metric,
      remainingBalance,
      dailyConsumption,
      recentDailyConsumption,
      yesterdayConsumption,
      dayBeforeConsumption,
      financeId: financeIdMap.get(metric) ?? null,
      lastUpdated: fetchedAt,
    });
  }

  return result.sort((a, b) => {
    const effectiveA = a.dailyConsumption > 0 ? a.dailyConsumption : a.recentDailyConsumption;
    const effectiveB = b.dailyConsumption > 0 ? b.dailyConsumption : b.recentDailyConsumption;
    const daysA = effectiveA > 0 ? a.remainingBalance / effectiveA : Infinity;
    const daysB = effectiveB > 0 ? b.remainingBalance / effectiveB : Infinity;
    return daysA - daysB;
  });
}

export function findDashboardOrganization(
  frames: GrafanaFrame[],
  metric: string,
): DashboardOrganization | undefined {
  return parseDashboardOrganizations(frames)
    .find((organization) => organization.metric === metric);
}

export function parseDashboardOrganizations(frames: GrafanaFrame[]): DashboardOrganization[] {
  const organizations: DashboardOrganization[] = [];
  const seenMetrics = new Set<string>();
  for (const row of frameRows(frames)) {
    const organization = organisationFromRow(row);
    if (!organization || seenMetrics.has(organization.metric)) continue;
    seenMetrics.add(organization.metric);
    organizations.push(organization);
  }
  return organizations;
}

function toIsoDate(value: unknown): string | null {
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isNextCalendarDay(previousDate: string, currentDate: string): boolean {
  const previous = new Date(previousDate);
  const current = new Date(currentDate);
  return current.getTime() - previous.getTime() === 86_400_000;
}

function mostRecentContiguousRun(history: OrganizationStudyPoint[]): OrganizationStudyPoint[] {
  if (history.length === 0) return [];

  let currentRun = [history[0]];
  let mostRecentRun = currentRun;

  for (let index = 1; index < history.length; index++) {
    const point = history[index];
    if (isNextCalendarDay(history[index - 1].date, point.date)) {
      currentRun.push(point);
    } else {
      currentRun = [point];
      mostRecentRun = currentRun;
    }
  }

  return mostRecentRun;
}

function chooseStudyRate(history: OrganizationStudyPoint[]): {
  averageDailyConsumption: number;
  rateWindowDays: number;
  rateBasis: string;
} {
  const candidates = [
    { window: 90, minimumCoverage: 60, label: "90-day average" },
    { window: 30, minimumCoverage: 20, label: "30-day fallback average" },
    { window: 7, minimumCoverage: 5, label: "7-day fallback average" },
  ];

  for (const candidate of candidates) {
    // Each history record is already a verified one-day interval: the SQL
    // removes the first snapshot and any non-consecutive pair. Therefore the
    // interval count is the correct denominator, not the raw date span.
    const intervals = history.slice(-candidate.window);
    if (intervals.length < candidate.minimumCoverage) continue;
    const averageDailyConsumption = intervals.reduce((total, point) => total + point.consumption, 0) / intervals.length;
    return {
      averageDailyConsumption,
      rateWindowDays: intervals.length,
      rateBasis: `${candidate.label} (${intervals.length} valid daily interval${intervals.length === 1 ? "" : "s"})`,
    };
  }
  return { averageDailyConsumption: 0, rateWindowDays: 0, rateBasis: "Insufficient daily history" };
}

function computeSeverity(
  daysRemaining: number,
  thresholdStaff: number,
  thresholdManager: number,
  thresholdMd: number,
  thresholdImmediate: number,
): string {
  if (daysRemaining < thresholdImmediate) return "immediate";
  if (daysRemaining < thresholdMd) return "emergency";
  if (daysRemaining < thresholdManager) return "critical";
  if (daysRemaining < thresholdStaff) return "warning";
  return "ok";
}

export function buildOrganizationStudy(input: {
  summaryFrames: GrafanaFrame[];
  childFrames: GrafanaFrame[];
  historyFrames: GrafanaFrame[];
  metric: string;
  fetchedAt: string;
  thresholds?: {
    staff?: number;
    manager?: number;
    md?: number;
    immediate?: number;
  };
}): OrganizationStudyData | null {
  const organization = findDashboardOrganization(input.summaryFrames, input.metric);
  if (!organization) return null;

  const rawHistory: RawStudyPoint[] = frameRows(input.historyFrames)
    .map((row): RawStudyPoint | null => {
      const date = toIsoDate(row.date);
      if (!date) return null;
      return {
        point: {
          date,
          balance: numberValue(row.balance),
          consumption: numberValue(row.consumption),
        },
        hasCompleteHierarchy: numberValue(row.is_complete) === 1,
      };
    })
    .filter((entry): entry is RawStudyPoint => entry !== null)
    .sort((a, b) => a.point.date.localeCompare(b.point.date));

  const incompleteHierarchyDays = rawHistory.filter((entry) => !entry.hasCompleteHierarchy).length;
  const completeHistory = rawHistory
    .filter((entry) => entry.hasCompleteHierarchy)
    .map((entry) => entry.point);
  // The SQL filters gap pairs before it emits a consumption row. Keep a
  // boundary check here too: only the most recent contiguous daily run may
  // contribute to a rate, so a future query change cannot combine separate
  // windows into a one-day estimate.
  const history = mostRecentContiguousRun(completeHistory);
  const fragmentedHistoryIntervals = completeHistory.length - history.length;
  const rate = chooseStudyRate(history);
  const thresholds = input.thresholds ?? {};
  const rawDays = rate.averageDailyConsumption > 0
    ? organization.remainingBalance / rate.averageDailyConsumption
    : null;
  const daysRemaining = rawDays === null ? -1 : Math.max(0, Math.round(rawDays * 10) / 10);
  const severity = rawDays === null
    ? "ok"
    : computeSeverity(
      daysRemaining,
      thresholds.staff ?? 20,
      thresholds.manager ?? 15,
      thresholds.md ?? 5,
      thresholds.immediate ?? 1,
    );

  const dataQuality: string[] = [];
  if (organization.financeId === null || Number(organization.financeId) <= 0) {
    dataQuality.push("Finance ID is missing or invalid.");
  }
  if (organization.remainingBalance < 0) dataQuality.push("Remaining balance is negative.");
  else if (organization.remainingBalance === 0) dataQuality.push("Remaining balance is zero.");
  if (incompleteHierarchyDays > 0) {
    dataQuality.push(`${incompleteHierarchyDays} partial hierarchy day(s) were excluded from the consumption forecast.`);
  }
  if (fragmentedHistoryIntervals > 0) {
    dataQuality.push(`${fragmentedHistoryIntervals} older or non-consecutive daily interval(s) were excluded from the consumption forecast.`);
  }
  if (history.length < 60) dataQuality.push(`Only ${history.length} days of usable history are available.`);
  if (rate.averageDailyConsumption <= 0) {
    dataQuality.push(
      incompleteHierarchyDays > 0 || fragmentedHistoryIntervals > 0
        ? "No forecast is shown because the full hierarchy has no complete consecutive daily consumption window."
        : "No positive consumption rate can be calculated from the available history.",
    );
  }

  return {
    metric: organization.metric,
    financeId: organization.financeId,
    usesOrgBalance: organization.usesOrgBalance,
    remainingBalance: organization.remainingBalance,
    children: parseOrganizationChildren(input.childFrames),
    dailyHistory: history,
    averageDailyConsumption: rate.averageDailyConsumption,
    rateWindowDays: rate.rateWindowDays,
    coverageDays: history.length,
    daysRemaining,
    severity,
    rateBasis: rate.rateBasis,
    dataQuality,
    lastUpdated: input.fetchedAt,
  };
}