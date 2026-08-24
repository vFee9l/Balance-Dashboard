import { Router } from "express";
import { sql } from "drizzle-orm";
import { fetch as undiciFetch, Agent } from "undici";
import { db, settingsTable, alertHistoryTable, contactsTable, clientDailyConsumptionTable } from "@workspace/db";
import {
  GetGrafanaOrganizationStudyQueryParams,
  GetGrafanaOrganizationStudyResponse,
  ListGrafanaOrganizationsResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { recordGrafanaFetch } from "../lib/healthTracker.js";
import nodemailer from "nodemailer";

// Custom undici agent with a 30-second TCP connect timeout (default is 10 s).
// Grafana at grafana.t2.sa can be slow to accept connections under load.
// Both fetch and Agent are from the same undici package to avoid version mismatch.
const grafanaAgent = new Agent({ connect: { timeout: 30_000 } });
const grafanaDatasource = { type: "mssql", uid: "af0fc2y09shdsd" };
const grafanaRootOrganizationId = "156347F0-A8AC-45EA-85AD-701F4F925F5C";

const router = Router();

interface ClientBalanceData {
  metric: string;
  remainingBalance: number;
  dailyConsumption: number;
  recentDailyConsumption: number;
  yesterdayConsumption: number;
  dayBeforeConsumption: number | null;
  financeId: string | null;
}

interface GrafanaFrame {
  schema: {
    fields: Array<{ name: string; type: string }>;
  };
  data: {
    values: unknown[][];
  };
}

interface GrafanaQueryResponse {
  results: {
    [refId: string]: {
      frames?: GrafanaFrame[];
      error?: string;
    };
  };
}

type GrafanaRow = Record<string, unknown>;

interface DashboardOrganization {
  metric: string;
  financeId: string | null;
  usesOrgBalance: boolean;
  remainingBalance: number;
}

interface OrganizationStudyPoint {
  date: string;
  balance: number;
  consumption: number;
}

// This is the same calculated hierarchy total used by Grafana dashboard th4qhrb.
// In particular, it correctly rolls AlRajhi's sub-organization balances into the
// selected main organization's live balance.
const dashboardSummarySql = `
  DECLARE @data TABLE (
    MainOrganizationId NVARCHAR(200),
    MainOrganisationName NVARCHAR(200),
    MainFinanceAccountId NVARCHAR(200),
    MainUsesOrgBalance INT,
    MainOwnBalance DECIMAL(18,3),
    SubOrganizationBalance DECIMAL(18,3),
    SubOrganizationCount INT,
    TotalBalance DECIMAL(18,3)
  )
  INSERT INTO @data
  EXEC [RiCH-Web].[dbo].[usp_GetClientBalancesDashboard]
    @RootOrganizationId = '${grafanaRootOrganizationId}'

  SELECT
    MainOrganisationName AS metric,
    MainFinanceAccountId AS finance_id,
    MainUsesOrgBalance AS uses_org_balance,
    TotalBalance AS Remaining_Balance
  FROM @data
  WHERE MainOrganisationName IS NOT NULL
  ORDER BY MainOrganisationName
`;

async function fetchGrafanaBalances(): Promise<ClientBalanceData[]> {
  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];
  const grafanaUrl = settings?.grafanaUrl || "https://grafana.t2.sa";
  const apiKey = settings?.grafanaApiKey;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey && apiKey !== "***") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // OrgConfig CTE: identifies which orgs use TotalOrganizationBalance instead of TotalUserBalance.
  // Mirrors the exact logic from the Grafana dashboard query.
  const orgConfigCte = `
    OrgConfig AS (
      SELECT DISTINCT OrganizationId AS id
      FROM [RiCH-Web].[dbo].[OrganizationConfiguration]
      WHERE [Key] = 'Use Organization Balance' AND LOWER([Value]) = 'true'
      UNION SELECT '47a48d76-a97b-4bd2-83b4-2f6f08564261'
      UNION SELECT '233d22b2-f80f-44aa-b95d-a6524f4f03ef'
      UNION SELECT '52cf3b17-a7fc-4e1c-b62a-5ac5cd2516c1'
    )
  `;

  // Query A: Grafana's calculated hierarchy total per main organization.
  // This replaces the raw hourly snapshot so clients such as AlRajhi match
  // dashboard th4qhrb, including balances held by their sub-organizations.
  const balanceSql = dashboardSummarySql;

  // Query B: Adaptive long-term average daily consumption (up to 32 days).
  // Finds the OLDEST available snapshot in the last 32 days and divides the balance
  // drop by the actual elapsed days (DATEDIFF). This means:
  //   - Clients with 30+ days of history  → avg over ~30 days
  //   - Clients with only 5 days of history → avg over 5 days
  //   - Clients with NO history at all → excluded (consumption = 0)
  // This sidesteps the rigid fixed-window JOIN that excluded many valid clients.
  const consumptionSql = `
    WITH ${orgConfigCte},
    NowBal AS (
      SELECT
        o.name AS metric,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Bal,
        ROW_NUMBER() OVER (PARTITION BY o.name ORDER BY b.CreatedDate DESC) AS rn
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Hour] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE b.CreatedDate >= DATEADD(day, -2, CAST(GETDATE() AS DATE))
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    ),
    OldestBal AS (
      SELECT
        o.name AS metric,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Bal,
        b.CreatedDate,
        ROW_NUMBER() OVER (PARTITION BY o.name ORDER BY b.CreatedDate ASC) AS rn
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Hour] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE b.CreatedDate >= DATEADD(day, -32, CAST(GETDATE() AS DATE))
        AND b.CreatedDate <= DATEADD(day, -1, CAST(GETDATE() AS DATE))
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    )
    SELECT
      n.metric,
      CASE
        WHEN (o.Bal - n.Bal) > 0 AND DATEDIFF(day, o.CreatedDate, GETDATE()) > 0
        THEN (o.Bal - n.Bal) / CAST(DATEDIFF(day, o.CreatedDate, GETDATE()) AS FLOAT)
        ELSE 0
      END AS Avg_Daily_Consumption
    FROM NowBal n
    JOIN OldestBal o ON o.metric = n.metric
    WHERE n.rn = 1 AND o.rn = 1
  `;

  // Query D: Yesterday's actual consumption and the day before, per client.
  // Used to compute day-over-day percentage change (the "Daily Δ" column).
  const dayOverDaySql = `
    WITH ${orgConfigCte},
    DailyData AS (
      SELECT
        o.name AS metric,
        b.CreatedDate,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Balance,
        LAG(
          CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END
        ) OVER (PARTITION BY o.name ORDER BY b.CreatedDate ASC) AS Prev_Balance
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Daily] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE b.CreatedDate >= DATEADD(day, -3, CAST(GETDATE() AS DATE))
        AND b.CreatedDate <= CAST(GETDATE() AS DATE)
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    ),
    Consumption AS (
      SELECT
        metric,
        CreatedDate,
        CASE WHEN (Prev_Balance - Balance) > 0 THEN (Prev_Balance - Balance) ELSE 0 END AS daily_consumption
      FROM DailyData
      WHERE Prev_Balance IS NOT NULL
    )
    SELECT
      c1.metric,
      c1.daily_consumption AS yesterday_consumption,
      c2.daily_consumption AS day_before_consumption
    FROM Consumption c1
    LEFT JOIN Consumption c2
      ON c1.metric = c2.metric
      AND c2.CreatedDate = DATEADD(day, -1, c1.CreatedDate)
    WHERE c1.CreatedDate = DATEADD(day, -1, CAST(GETDATE() AS DATE))
  `;

  // Query C: Adaptive short-term average daily consumption (up to 9 days).
  // Same adaptive approach as Query B but over a shorter window.
  // Finds the oldest available snapshot in the last 9 days so that even clients
  // with only 1-2 days of hourly history can produce a recent rate estimate.
  const recentConsumptionSql = `
    WITH ${orgConfigCte},
    NowBal AS (
      SELECT
        o.name AS metric,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Bal,
        ROW_NUMBER() OVER (PARTITION BY o.name ORDER BY b.CreatedDate DESC) AS rn
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Hour] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE b.CreatedDate >= DATEADD(day, -2, CAST(GETDATE() AS DATE))
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    ),
    OldestBal AS (
      SELECT
        o.name AS metric,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Bal,
        b.CreatedDate,
        ROW_NUMBER() OVER (PARTITION BY o.name ORDER BY b.CreatedDate ASC) AS rn
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Hour] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE b.CreatedDate >= DATEADD(day, -9, CAST(GETDATE() AS DATE))
        AND b.CreatedDate <= DATEADD(day, -1, CAST(GETDATE() AS DATE))
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    )
    SELECT
      n.metric,
      CASE
        WHEN (o.Bal - n.Bal) > 0 AND DATEDIFF(day, o.CreatedDate, GETDATE()) > 0
        THEN (o.Bal - n.Bal) / CAST(DATEDIFF(day, o.CreatedDate, GETDATE()) AS FLOAT)
        ELSE 0
      END AS Avg_Daily_Consumption_Recent
    FROM NowBal n
    JOIN OldestBal o ON o.metric = n.metric
    WHERE n.rn = 1 AND o.rn = 1
  `;

  // Hierarchy-safe daily rates for operational monitoring and alerts. A main
  // organization is only given a rate when every organization contributing to
  // its calculated summary balance has a daily snapshot for that date.
  const hierarchyConsumptionSql = `
    DECLARE @data TABLE (
      OrganizationId NVARCHAR(100),
      OrganisationName NVARCHAR(200),
      FinanceAccountId INT,
      ParentOrganisationId NVARCHAR(100),
      OrgLevel NVARCHAR(10),
      RollsUpToMainOrganizationId NVARCHAR(100),
      UsesOrgBalance INT,
      CalculatedBalance DECIMAL(18,3)
    )
    INSERT INTO @data
    EXEC [RiCH-Web].[dbo].[usp_GetClientBalancesDashboard]
      @RootOrganizationId = '${grafanaRootOrganizationId}',
      @Mode = 'DETAIL'

    ;WITH MainOrganizations AS (
      SELECT OrganizationId AS MainOrganizationId, OrganisationName AS metric
      FROM @data
      WHERE OrgLevel = 'main'
    ),
    ExpectedHierarchy AS (
      SELECT RollsUpToMainOrganizationId AS MainOrganizationId, COUNT(*) AS expected_organization_count
      FROM @data
      GROUP BY RollsUpToMainOrganizationId
    ),
    AggregatedDailyBalances AS (
      SELECT
        d.RollsUpToMainOrganizationId AS MainOrganizationId,
        CAST(h.CreatedDate AS DATE) AS date,
        CAST(SUM(CASE
          WHEN d.UsesOrgBalance = 1 THEN COALESCE(h.TotalOrganizationBalance, 0)
          ELSE COALESCE(h.TotalUserBalance, 0)
        END) AS DECIMAL(18,3)) AS balance,
        COUNT(DISTINCT d.OrganizationId) AS organization_count
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Daily] h
      JOIN @data d ON d.OrganizationId = h.Id
      WHERE h.CreatedDate >= DATEADD(day, -33, CAST(GETDATE() AS DATE))
        AND h.CreatedDate <= CAST(GETDATE() AS DATE)
      GROUP BY d.RollsUpToMainOrganizationId, CAST(h.CreatedDate AS DATE)
    ),
    CompleteDailyBalances AS (
      SELECT daily.MainOrganizationId, daily.date, daily.balance
      FROM AggregatedDailyBalances daily
      JOIN ExpectedHierarchy expected ON expected.MainOrganizationId = daily.MainOrganizationId
      WHERE daily.organization_count = expected.expected_organization_count
    ),
    DailyDeltas AS (
      SELECT
        MainOrganizationId,
        date,
        balance,
        LAG(balance) OVER (PARTITION BY MainOrganizationId ORDER BY date ASC) AS previous_balance,
        LAG(date) OVER (PARTITION BY MainOrganizationId ORDER BY date ASC) AS previous_date
      FROM CompleteDailyBalances
    ),
    Consumption AS (
      SELECT
        MainOrganizationId,
        date,
        CASE
          WHEN DATEDIFF(day, previous_date, date) = 1 AND previous_balance - balance > 0
          THEN previous_balance - balance
          ELSE 0
        END AS daily_consumption,
        CASE WHEN DATEDIFF(day, previous_date, date) = 1 THEN 1 ELSE 0 END AS has_adjacent_previous
      FROM DailyDeltas
    )
    SELECT
      main.metric,
      CAST(SUM(CASE
        WHEN consumption.has_adjacent_previous = 1
          AND consumption.date >= DATEADD(day, -32, CAST(GETDATE() AS DATE))
        THEN consumption.daily_consumption ELSE 0 END) AS FLOAT)
        / NULLIF(SUM(CASE
          WHEN consumption.has_adjacent_previous = 1
            AND consumption.date >= DATEADD(day, -32, CAST(GETDATE() AS DATE))
          THEN 1 ELSE 0 END), 0) AS Avg_Daily_Consumption,
      CAST(SUM(CASE
        WHEN consumption.has_adjacent_previous = 1
          AND consumption.date >= DATEADD(day, -9, CAST(GETDATE() AS DATE))
        THEN consumption.daily_consumption ELSE 0 END) AS FLOAT)
        / NULLIF(SUM(CASE
          WHEN consumption.has_adjacent_previous = 1
            AND consumption.date >= DATEADD(day, -9, CAST(GETDATE() AS DATE))
          THEN 1 ELSE 0 END), 0) AS Avg_Daily_Consumption_Recent,
      MAX(CASE WHEN consumption.has_adjacent_previous = 1
        AND consumption.date = DATEADD(day, -1, CAST(GETDATE() AS DATE))
        THEN consumption.daily_consumption END) AS yesterday_consumption,
      MAX(CASE WHEN consumption.has_adjacent_previous = 1
        AND consumption.date = DATEADD(day, -2, CAST(GETDATE() AS DATE))
        THEN consumption.daily_consumption END) AS day_before_consumption
    FROM MainOrganizations main
    LEFT JOIN Consumption ON Consumption.MainOrganizationId = main.MainOrganizationId
    GROUP BY main.metric
  `;

  const payload = {
    queries: [
      {
        refId: "A",
        datasource: { type: "mssql", uid: "af0fc2y09shdsd" },
        rawSql: balanceSql,
        format: "table",
        rawQuery: true,
        dataset: "reportag4-25",
      },
      {
        refId: "B",
        datasource: { type: "mssql", uid: "af0fc2y09shdsd" },
        rawSql: hierarchyConsumptionSql,
        format: "table",
        rawQuery: true,
        dataset: "reportag4-25",
      },
    ],
    from: "now-65d",
    to: "now",
  };

  const grafanaFetch = async () => undiciFetch(`${grafanaUrl}/api/ds/query`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
    dispatcher: grafanaAgent,
  });

  try {
    let resp: Response;
    try {
      resp = await grafanaFetch();
    } catch (firstErr) {
      logger.warn({ err: firstErr }, "Grafana fetch failed on first attempt, retrying in 5 s…");
      await new Promise((r) => setTimeout(r, 5_000));
      resp = await grafanaFetch();
    }

    if (!resp.ok) {
      logger.warn({ status: resp.status, url: grafanaUrl }, "Grafana query failed");
      recordGrafanaFetch(false, `HTTP ${resp.status}`);
      return [];
    }

    const data = (await resp.json()) as GrafanaQueryResponse;
    const balanceFrames = data?.results?.A?.frames ?? [];
    const consumptionFrames = data?.results?.B?.frames ?? [];
    const recentConsumptionFrames = consumptionFrames;
    const dayOverDayFrames = consumptionFrames;

    // Log any Grafana-level errors per query to diagnose missing data
    for (const [refId, result] of Object.entries(data?.results ?? {})) {
      if (result.error) {
        logger.warn({ refId, error: result.error }, "Grafana sub-query returned error");
      } else {
        logger.info({ refId, frameCount: result.frames?.length ?? 0 }, "Grafana sub-query frames");
      }
    }

    if (balanceFrames.length === 0) {
      logger.warn("Grafana returned no balance frames");
      recordGrafanaFetch(false, "No balance frames returned");
      return [];
    }

    recordGrafanaFetch(true);
    return parseFramesToBalances(balanceFrames, consumptionFrames, recentConsumptionFrames, dayOverDayFrames);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Grafana fetch error");
    recordGrafanaFetch(false, msg);
    return [];
  }
}

function extractFrameMap(frames: GrafanaFrame[], metricField: string, valueField: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const metricIdx = fields.findIndex((f) => f.name === metricField);
    const valueIdx = fields.findIndex((f) => f.name === valueField);
    if (metricIdx === -1 || valueIdx === -1) continue;
    const metrics = (values[metricIdx] ?? []) as string[];
    const vals = (values[valueIdx] ?? []) as number[];
    for (let i = 0; i < metrics.length; i++) {
      map.set(metrics[i], Number(vals[i] ?? 0));
    }
  }
  return map;
}

function extractStringFrameMap(frames: GrafanaFrame[], metricField: string, valueField: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const metricIdx = fields.findIndex((f) => f.name === metricField);
    const valueIdx = fields.findIndex((f) => f.name === valueField);
    if (metricIdx === -1 || valueIdx === -1) continue;
    const metrics = (values[metricIdx] ?? []) as string[];
    const vals = (values[valueIdx] ?? []) as (string | number | null)[];
    for (let i = 0; i < metrics.length; i++) {
      const v = vals[i];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        map.set(metrics[i], String(v).trim());
      }
    }
  }
  return map;
}

function parseFramesToBalances(
  balanceFrames: GrafanaFrame[],
  consumptionFrames: GrafanaFrame[],
  recentConsumptionFrames: GrafanaFrame[],
  dayOverDayFrames: GrafanaFrame[]
): ClientBalanceData[] {
  // Build balance map: metric → latest remaining balance
  const balanceMap = extractFrameMap(balanceFrames, "metric", "Remaining_Balance");

  const financeIdMap = extractStringFrameMap(balanceFrames, "metric", "finance_id");

  // Build consumption map: metric → avg daily consumption (same period last month)
  const consumptionMap = extractFrameMap(consumptionFrames, "metric", "Avg_Daily_Consumption");

  // Build recent consumption map: metric → avg daily consumption (last 7 days)
  const recentConsumptionMap = extractFrameMap(recentConsumptionFrames, "metric", "Avg_Daily_Consumption_Recent");

  // Build day-over-day maps: yesterday and day-before consumption
  const yesterdayMap = extractFrameMap(dayOverDayFrames, "metric", "yesterday_consumption");
  const dayBeforeMap = extractFrameMap(dayOverDayFrames, "metric", "day_before_consumption");

  const result: ClientBalanceData[] = [];
  for (const [metric, remainingBalance] of balanceMap.entries()) {
    const dailyConsumption = consumptionMap.get(metric) ?? 0;
    const yesterdayConsumption = yesterdayMap.get(metric) ?? 0;
    const dayBeforeRaw = dayBeforeMap.get(metric);
    const dayBeforeConsumption = dayBeforeRaw !== undefined ? dayBeforeRaw : null;

    // Prefer the 9-day adaptive rate; if it's still 0 but we have yesterday's
    // actual consumption, use that as a last-resort 1-day rate estimate.
    const rawRecent = recentConsumptionMap.get(metric) ?? 0;
    const recentDailyConsumption = rawRecent > 0 ? rawRecent : (dailyConsumption === 0 && yesterdayConsumption > 0 ? yesterdayConsumption : 0);

    const financeId = financeIdMap.get(metric) ?? null;
    result.push({ metric, remainingBalance, dailyConsumption, recentDailyConsumption, yesterdayConsumption, dayBeforeConsumption, financeId });
  }

  // Sort by effective days remaining (monthly rate preferred, 7-day fallback).
  // Clients with no consumption data at all sort to the bottom.
  return result.sort((a, b) => {
    const effA = a.dailyConsumption > 0 ? a.dailyConsumption : a.recentDailyConsumption;
    const effB = b.dailyConsumption > 0 ? b.dailyConsumption : b.recentDailyConsumption;
    const daysA = effA > 0 ? a.remainingBalance / effA : Infinity;
    const daysB = effB > 0 ? b.remainingBalance / effB : Infinity;
    return daysA - daysB;
  });
}

function frameRows(frames: GrafanaFrame[]): GrafanaRow[] {
  const rows: GrafanaRow[] = [];
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const rowCount = Math.max(0, ...values.map((value) => Array.isArray(value) ? value.length : 0));
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const row: GrafanaRow = {};
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

function organisationFromRow(row: GrafanaRow): DashboardOrganization | null {
  const metric = stringValue(row.metric);
  if (!metric) return null;
  const financeId = stringValue(row.finance_id);
  return {
    metric,
    financeId,
    usesOrgBalance: numberValue(row.uses_org_balance) === 1,
    remainingBalance: numberValue(row.Remaining_Balance),
  };
}

async function queryGrafana(queries: Array<{ refId: string; rawSql: string }>): Promise<GrafanaQueryResponse> {
  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];
  const grafanaUrl = settings?.grafanaUrl || "https://grafana.t2.sa";
  const apiKey = settings?.grafanaApiKey;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey && apiKey !== "***") headers.Authorization = `Bearer ${apiKey}`;

  const execute = () => undiciFetch(`${grafanaUrl}/api/ds/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      queries: queries.map((query) => ({
        refId: query.refId,
        datasource: grafanaDatasource,
        rawSql: query.rawSql,
        format: "table",
        rawQuery: true,
        dataset: "reportag4-25",
      })),
      from: "now-95d",
      to: "now",
    }),
    signal: AbortSignal.timeout(45_000),
    dispatcher: grafanaAgent,
  });

  let response: Response;
  try {
    response = await execute();
  } catch (firstError) {
    logger.warn({ err: firstError }, "Grafana dashboard query failed on first attempt, retrying");
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    response = await execute();
  }
  if (!response.ok) throw new Error(`Grafana returned HTTP ${response.status}`);

  const data = (await response.json()) as GrafanaQueryResponse;
  for (const [refId, result] of Object.entries(data.results ?? {})) {
    if (result.error) throw new Error(`Grafana ${refId} query failed: ${result.error}`);
  }
  return data;
}

function isSafeOrganizationMetric(metric: string): boolean {
  return metric.length > 0
    && metric.length <= 200
    && /^[\p{L}\p{N} ._()&-]+$/u.test(metric);
}

function studyHistorySql(metric: string): string {
  const escapedMetric = metric.replace(/'/g, "''");
  return `
    -- Uses the same balance-mode rule as the summary, across every organization
    -- that rolls up to the selected main organization.
    DECLARE @data TABLE (
      OrganizationId NVARCHAR(100),
      OrganisationName NVARCHAR(200),
      FinanceAccountId INT,
      ParentOrganisationId NVARCHAR(100),
      OrgLevel NVARCHAR(10),
      RollsUpToMainOrganizationId NVARCHAR(100),
      UsesOrgBalance INT,
      CalculatedBalance DECIMAL(18,3)
    )
    INSERT INTO @data
    EXEC [RiCH-Web].[dbo].[usp_GetClientBalancesDashboard]
      @RootOrganizationId = '${grafanaRootOrganizationId}',
      @Mode = 'DETAIL'

    DECLARE @MainOrgId NVARCHAR(100)
    SELECT TOP 1 @MainOrgId = RollsUpToMainOrganizationId
    FROM @data
    WHERE OrganisationName = '${escapedMetric}'
      AND OrgLevel = 'main'

    DECLARE @ExpectedOrganizationCount INT = (
      SELECT COUNT(*)
      FROM @data
      WHERE RollsUpToMainOrganizationId = @MainOrgId
    )

    ;WITH AggregatedDailyBalances AS (
      SELECT
        CAST(h.CreatedDate AS DATE) AS date,
        CAST(SUM(CASE
          WHEN d.UsesOrgBalance = 1 THEN COALESCE(h.TotalOrganizationBalance, 0)
          ELSE COALESCE(h.TotalUserBalance, 0)
        END) AS DECIMAL(18,3)) AS balance,
        COUNT(DISTINCT d.OrganizationId) AS organization_count
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Daily] h
      JOIN @data d ON d.OrganizationId = h.Id
      WHERE d.RollsUpToMainOrganizationId = @MainOrgId
        AND h.CreatedDate >= DATEADD(day, -90, CAST(GETDATE() AS DATE))
        AND h.CreatedDate <= CAST(GETDATE() AS DATE)
      GROUP BY CAST(h.CreatedDate AS DATE)
    ),
    CompleteDailyBalances AS (
      SELECT date, balance, organization_count
      FROM AggregatedDailyBalances
      WHERE organization_count = @ExpectedOrganizationCount
    ),
    DailyBalances AS (
      SELECT
        date,
        balance,
        organization_count,
        LAG(balance) OVER (ORDER BY date ASC) AS previous_balance,
        LAG(date) OVER (ORDER BY date ASC) AS previous_date
      FROM CompleteDailyBalances
    )
    SELECT
      date,
      balance,
      CASE WHEN previous_balance - balance > 0 THEN previous_balance - balance ELSE 0 END AS consumption,
      organization_count,
      @ExpectedOrganizationCount AS expected_organization_count,
      1 AS is_complete
    FROM DailyBalances
    WHERE previous_balance IS NOT NULL
      AND DATEDIFF(day, previous_date, date) = 1
    UNION ALL
    SELECT
      date,
      balance,
      0 AS consumption,
      organization_count,
      @ExpectedOrganizationCount AS expected_organization_count,
      0 AS is_complete
    FROM AggregatedDailyBalances
    WHERE organization_count <> @ExpectedOrganizationCount
    ORDER BY date
  `;
}

function toIsoDate(value: unknown): string | null {
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    const points = history.slice(-candidate.window);
    if (points.length < candidate.minimumCoverage) continue;
    const averageDailyConsumption = points.reduce((total, point) => total + point.consumption, 0) / points.length;
    return { averageDailyConsumption, rateWindowDays: points.length, rateBasis: candidate.label };
  }
  return { averageDailyConsumption: 0, rateWindowDays: 0, rateBasis: "Insufficient daily history" };
}

router.get("/grafana/organizations", async (req, res): Promise<void> => {
  try {
    const data = await queryGrafana([{ refId: "S", rawSql: dashboardSummarySql }]);
    const organizations = frameRows(data.results.S?.frames ?? [])
      .map(organisationFromRow)
      .filter((organization): organization is DashboardOrganization => organization !== null);
    res.json(ListGrafanaOrganizationsResponse.parse(organizations));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Grafana organization directory");
    res.status(502).json({ error: "Unable to load organization data from Grafana." });
  }
});

router.get("/grafana/organization-study", async (req, res): Promise<void> => {
  const params = GetGrafanaOrganizationStudyQueryParams.safeParse(req.query);
  if (!params.success || !isSafeOrganizationMetric(params.data.metric)) {
    res.status(400).json({ error: "A valid organization name is required." });
    return;
  }

  try {
    const data = await queryGrafana([
      { refId: "S", rawSql: dashboardSummarySql },
      { refId: "H", rawSql: studyHistorySql(params.data.metric) },
    ]);
    const organization = frameRows(data.results.S?.frames ?? [])
      .map(organisationFromRow)
      .find((entry) => entry?.metric === params.data.metric);
    if (!organization) {
      res.status(404).json({ error: "Organization was not found in Grafana." });
      return;
    }

    const rawHistory = frameRows(data.results.H?.frames ?? [])
      .map((row): { point: OrganizationStudyPoint; hasCompleteHierarchy: boolean } | null => {
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
      .filter((entry): entry is { point: OrganizationStudyPoint; hasCompleteHierarchy: boolean } => entry !== null)
      .sort((a, b) => a.point.date.localeCompare(b.point.date));
    const incompleteHierarchyDays = rawHistory.filter((entry) => !entry.hasCompleteHierarchy).length;
    const history = rawHistory
      .filter((entry) => entry.hasCompleteHierarchy)
      .map((entry) => entry.point);

    const rate = chooseStudyRate(history);
    const settingsRows = await db.select().from(settingsTable).limit(1);
    const settings = settingsRows[0];
    const rawDays = rate.averageDailyConsumption > 0
      ? organization.remainingBalance / rate.averageDailyConsumption
      : null;
    const daysRemaining = rawDays === null ? -1 : Math.max(0, Math.round(rawDays * 10) / 10);
    const severity = rawDays === null
      ? "ok"
      : computeSeverity(
          daysRemaining,
          settings?.thresholdStaff ?? 20,
          settings?.thresholdManager ?? 15,
          settings?.thresholdMd ?? 5,
          settings?.thresholdImmediate ?? 1,
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
    if (history.length < 60) dataQuality.push(`Only ${history.length} days of usable history are available.`);
    if (rate.averageDailyConsumption <= 0) dataQuality.push("No positive consumption rate can be calculated from the available history.");

    res.json(GetGrafanaOrganizationStudyResponse.parse({
      metric: organization.metric,
      financeId: organization.financeId,
      usesOrgBalance: organization.usesOrgBalance,
      remainingBalance: organization.remainingBalance,
      dailyHistory: history,
      averageDailyConsumption: rate.averageDailyConsumption,
      rateWindowDays: rate.rateWindowDays,
      coverageDays: history.length,
      daysRemaining,
      severity,
      rateBasis: rate.rateBasis,
      dataQuality,
      lastUpdated: new Date().toISOString(),
    }));
  } catch (error) {
    req.log.error({ err: error, metric: params.data.metric }, "Failed to load Grafana organization study");
    res.status(502).json({ error: "Unable to load organization study from Grafana." });
  }
});

function computeSeverity(
  daysRemaining: number,
  thresholdStaff: number,
  thresholdManager: number,
  thresholdMd: number,
  thresholdImmediate: number
): string {
  if (daysRemaining < thresholdImmediate) return "immediate";
  if (daysRemaining < thresholdMd) return "emergency";
  if (daysRemaining < thresholdManager) return "critical";
  if (daysRemaining < thresholdStaff) return "warning";
  return "ok";
}

/**
 * Format a numeric balance/consumption value for SMS — mirrors the
 * dashboard's K/M thresholds and adds comma thousands-separators so
 * the number is easy to read.
 *
 * Examples:
 *   24 500        →  "24.5 K"
 *   78 630 000    →  "78.63 M"
 *   1 555 000 000 →  "1,555.00 M"
 *   800           →  "800"
 */
function formatBalanceSms(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const v = value / 1_000_000;
    // toLocaleString adds commas to the integer part (e.g. "1,555.22 M")
    return (
      v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M"
    );
  }
  if (abs >= 1_000) {
    const v = value / 1_000;
    return (
      v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " K"
    );
  }
  return Math.round(value).toLocaleString("en-US");
}

function buildSmsBody(template: string | null | undefined, phone: string, message: string): string {
  const sub = (s: string) =>
    s.replace(/\{phone\}/g, phone)
     .replace(/\{to\}/g, phone)
     .replace(/\{number\}/g, phone)
     .replace(/\{message\}/g, message)
     .replace(/\{text\}/g, message);

  if (!template) return JSON.stringify({ to: phone, message });

  // Try to parse as JSON and substitute into the object — this ensures
  // newlines and special chars in `message` are properly JSON-escaped on stringify.
  try {
    const parsed = JSON.parse(template) as unknown;
    function subInValue(v: unknown): unknown {
      if (typeof v === "string") return sub(v);
      if (Array.isArray(v)) return v.map(subInValue);
      if (v !== null && typeof v === "object") {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, subInValue(val)])
        );
      }
      return v;
    }
    return JSON.stringify(subInValue(parsed));
  } catch {
    // Template is not JSON — fall back to plain string substitution
    return sub(template);
  }
}

router.get("/grafana/consumption-history", async (req, res): Promise<void> => {
  const metric = req.query["metric"];
  if (!metric || typeof metric !== "string") {
    res.status(400).json({ error: "metric query parameter is required" });
    return;
  }

  // Sanitise: only allow alphanumeric, spaces, hyphens, underscores, dots
  const safeMetric = metric.replace(/[^a-zA-Z0-9 \-_.()]/g, "");
  if (!safeMetric) {
    res.status(400).json({ error: "Invalid metric name" });
    return;
  }

  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];
  const grafanaUrl = settings?.grafanaUrl || "https://grafana.t2.sa";
  const apiKey = settings?.grafanaApiKey;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey && apiKey !== "***") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const orgConfigCte = `
    OrgConfig AS (
      SELECT DISTINCT OrganizationId AS id
      FROM [RiCH-Web].[dbo].[OrganizationConfiguration]
      WHERE [Key] = 'Use Organization Balance' AND LOWER([Value]) = 'true'
      UNION SELECT '47a48d76-a97b-4bd2-83b4-2f6f08564261'
      UNION SELECT '233d22b2-f80f-44aa-b95d-a6524f4f03ef'
      UNION SELECT '52cf3b17-a7fc-4e1c-b62a-5ac5cd2516c1'
    )
  `;

  // Fetch all daily balances for this client from start of last month to today
  // Then compute per-day consumption (positive balance drop)
  const historySql = `
    WITH ${orgConfigCte},
    DailyBalances AS (
      SELECT
        b.CreatedDate,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Balance,
        LAG(
          CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END
        ) OVER (ORDER BY b.CreatedDate ASC) AS Prev_Balance
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Daily] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE o.name = '${safeMetric}'
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
        AND b.CreatedDate >= DATEFROMPARTS(
          YEAR(DATEADD(month, -1, CAST(GETDATE() AS DATE))),
          MONTH(DATEADD(month, -1, CAST(GETDATE() AS DATE))),
          1
        )
        AND b.CreatedDate <= CAST(GETDATE() AS DATE)
    )
    SELECT
      CreatedDate AS date,
      CASE WHEN (Prev_Balance - Balance) > 0 THEN (Prev_Balance - Balance) ELSE 0 END AS daily_consumption
    FROM DailyBalances
    WHERE Prev_Balance IS NOT NULL
    ORDER BY CreatedDate
  `;

  try {
    const resp = await fetch(`${grafanaUrl}/api/ds/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queries: [{
          refId: "H",
          datasource: { type: "mssql", uid: "af0fc2y09shdsd" },
          rawSql: historySql,
          format: "table",
          rawQuery: true,
          dataset: "reportag4-25",
        }],
        from: "now-65d",
        to: "now",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Grafana consumption-history query failed");
      res.json({ metric: safeMetric, currentMonth: [], previousMonth: [], currentMonthLabel: "", previousMonthLabel: "" });
      return;
    }

    const data = (await resp.json()) as GrafanaQueryResponse;
    const frames = data?.results?.H?.frames ?? [];

    const now = new Date();
    const currentMonthNum = now.getMonth(); // 0-indexed
    const currentYear = now.getFullYear();
    const prevMonthDate = new Date(currentYear, currentMonthNum - 1, 1);
    const prevMonthNum = prevMonthDate.getMonth();
    const prevYear = prevMonthDate.getFullYear();

    const currentMonthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
    const previousMonthLabel = prevMonthDate.toLocaleString("en-US", { month: "long", year: "numeric" });

    const currentMonth: Array<{ day: number; date: string; consumption: number }> = [];
    const previousMonth: Array<{ day: number; date: string; consumption: number }> = [];

    for (const frame of frames) {
      const fields = frame.schema?.fields ?? [];
      const values = frame.data?.values ?? [];
      const dateIdx = fields.findIndex((f) => f.name === "date");
      const consIdx = fields.findIndex((f) => f.name === "daily_consumption");
      if (dateIdx === -1 || consIdx === -1) continue;

      const dates = (values[dateIdx] ?? []) as (string | number)[];
      const consumptions = (values[consIdx] ?? []) as number[];

      for (let i = 0; i < dates.length; i++) {
        const d = new Date(dates[i]);
        const dayOfMonth = d.getDate();
        const dateStr = d.toISOString().slice(0, 10);
        const consumption = Number(consumptions[i] ?? 0);

        if (d.getFullYear() === currentYear && d.getMonth() === currentMonthNum) {
          currentMonth.push({ day: dayOfMonth, date: dateStr, consumption });
        } else if (d.getFullYear() === prevYear && d.getMonth() === prevMonthNum) {
          previousMonth.push({ day: dayOfMonth, date: dateStr, consumption });
        }
      }
    }

    res.json({ metric: safeMetric, currentMonth, previousMonth, currentMonthLabel, previousMonthLabel });
  } catch (err) {
    logger.error({ err }, "Grafana consumption-history fetch error");
    res.json({ metric: safeMetric, currentMonth: [], previousMonth: [], currentMonthLabel: "", previousMonthLabel: "" });
  }
});

router.get("/grafana/balances", async (req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];
  const thresholdStaff = settings?.thresholdStaff ?? 20;
  const thresholdManager = settings?.thresholdManager ?? 15;
  const thresholdMd = settings?.thresholdMd ?? 5;
  const thresholdImmediate = settings?.thresholdImmediate ?? 1;

  const excludedOrgsSet = new Set(
    (settings?.excludedOrgs ?? "")
      .split(",")
      .map((o) => o.trim().toLowerCase())
      .filter((o) => o.length > 0)
  );

  const rawBalances = (await fetchGrafanaBalances()).filter(
    (b) => !excludedOrgsSet.has(b.metric.trim().toLowerCase())
  );

  const yesterdayDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

  const result = rawBalances.map((b) => {
    // Primary rate: full-previous-month avg. Fallback: 7-day recent avg.
    // This ensures Est. Days is always populated when at least one rate is available.
    const usingFallbackRate = b.dailyConsumption <= 0 && b.recentDailyConsumption > 0;
    const effectiveDaily = b.dailyConsumption > 0 ? b.dailyConsumption : b.recentDailyConsumption;
    const rawDays =
      effectiveDaily > 0
        ? b.remainingBalance / effectiveDaily
        : null;
    const daysRemaining =
      rawDays === null ? -1 : Math.max(0, Math.round(rawDays * 10) / 10);
    const severity =
      rawDays === null
        ? "ok"
        : computeSeverity(daysRemaining, thresholdStaff, thresholdManager, thresholdMd, thresholdImmediate);

    const rawDaysRecent =
      b.recentDailyConsumption > 0
        ? b.remainingBalance / b.recentDailyConsumption
        : null;
    const daysRemainingRecent =
      rawDaysRecent === null ? -1 : Math.max(0, Math.round(rawDaysRecent * 10) / 10);

    // Day-over-day percentage change: positive = more consumption (worse)
    let dailyChangePercent: number | null = null;
    if (b.dayBeforeConsumption !== null && b.dayBeforeConsumption > 0) {
      dailyChangePercent = Math.round(
        ((b.yesterdayConsumption - b.dayBeforeConsumption) / b.dayBeforeConsumption) * 1000
      ) / 10; // one decimal place
    }

    return {
      metric: b.metric,
      financeId: b.financeId ?? null,
      remainingBalance: b.remainingBalance,
      dailyConsumption: b.dailyConsumption,
      daysRemaining,
      recentDailyConsumption: b.recentDailyConsumption,
      daysRemainingRecent,
      usingFallbackRate,
      yesterdayConsumption: b.yesterdayConsumption,
      dailyChangePercent,
      severity,
      lastUpdated: new Date().toISOString(),
    };
  });

  // Upsert yesterday's consumption into DB for the monthly record
  // (we store yesterday's reading since it's final/stable; today is still accumulating)
  const upsertRows = rawBalances
    .filter((b) => b.yesterdayConsumption > 0)
    .map((b) => {
      const dailyChangePercent =
        b.dayBeforeConsumption !== null && b.dayBeforeConsumption > 0
          ? Math.round(
              ((b.yesterdayConsumption - b.dayBeforeConsumption) / b.dayBeforeConsumption) * 1000
            ) / 10
          : null;
      return {
        metric: b.metric,
        date: yesterdayDate,
        consumption: b.yesterdayConsumption,
        percentChange: dailyChangePercent,
      };
    });

  if (upsertRows.length > 0) {
    db.insert(clientDailyConsumptionTable)
      .values(upsertRows)
      .onConflictDoUpdate({
        target: [clientDailyConsumptionTable.metric, clientDailyConsumptionTable.date],
        set: {
          consumption: sql`excluded.consumption`,
          percentChange: sql`excluded.percent_change`,
        },
      })
      .catch((err: unknown) => logger.warn({ err }, "Failed to upsert daily consumption snapshot"));
  }

  // Populate the in-process balance cache for the Telegram bot /checkbalance command
  import("../lib/balanceCache.js").then(({ updateBalanceCache }) => {
    updateBalanceCache(
      result.map((r) => ({
        metric: r.metric,
        remainingBalance: r.remainingBalance,
        daysRemaining: r.daysRemaining,
        severity: r.severity,
        financeId: r.financeId ?? null,
      }))
    );
  }).catch(() => { /* non-fatal */ });

  res.json(result);
});

async function sendSmsNotification(
  phoneNumber: string,
  message: string,
  settings: {
    smsApiUrl?: string | null;
    smsBodyTemplate?: string | null;
  }
): Promise<{ ok: boolean; error: string | null }> {
  if (!settings.smsApiUrl) return { ok: false, error: "SMS API URL not configured" };
  try {
    const rawBody = buildSmsBody(settings.smsBodyTemplate, phoneNumber, message);

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }

    const isJson = typeof parsedBody === "object";
    const outgoingBody = isJson ? JSON.stringify(parsedBody) : rawBody;
    logger.info({ phoneNumber, url: settings.smsApiUrl, body: outgoingBody }, "SMS API request");
    const resp = await fetch(settings.smsApiUrl, {
      method: "POST",
      headers: { "Content-Type": isJson ? "application/json" : "text/plain" },
      body: outgoingBody,
      signal: AbortSignal.timeout(10000),
    });

    const responseText = await resp.text().catch(() => "(unreadable)");

    if (!resp.ok) {
      logger.warn({ status: resp.status, phoneNumber, responseBody: responseText, sentBody: outgoingBody }, "SMS API returned HTTP error");
      return { ok: false, error: `HTTP ${resp.status}: ${responseText}` };
    }

    let apiJson: { Code?: number; Description?: string; HasError?: boolean } = {};
    try { apiJson = JSON.parse(responseText); } catch { /* non-JSON body */ }

    if (apiJson.Code !== undefined && apiJson.Code !== 0) {
      const desc = apiJson.Description ?? responseText;
      logger.warn({ phoneNumber, code: apiJson.Code, description: desc }, "SMS API returned failure code");
      return { ok: false, error: `Code ${apiJson.Code}: ${desc}` };
    }

    logger.info({ phoneNumber, response: apiJson }, "SMS sent successfully");
    return { ok: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, phoneNumber }, "SMS send failed");
    return { ok: false, error: msg };
  }
}

async function sendTelegramNotification(
  message: string,
  settings: { telegramBotToken?: string | null; telegramChatId?: string | null }
): Promise<boolean> {
  if (!settings.telegramBotToken || !settings.telegramChatId) return false;
  if (settings.telegramBotToken === "***") return false;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: message,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return resp.ok;
  } catch (err) {
    logger.warn({ err }, "Telegram send failed");
    return false;
  }
}

// ─── Google Sheet contact row ──────────────────────────────────────────────────
// Per-client row from the Google Sheet, keyed by Finance ID (column E, index 4).
// All CSV columns are kept as rawCols so the alert logic can read any column
// by its configured letter(s) without hardcoding the field mapping here.
interface SheetRow {
  financeId: string;
  rawCols: string[]; // full parsed CSV column array for this row
}

// Parse a CSV line, respecting double-quoted fields that may contain commas.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { result.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

// Split a cell value that may contain multiple comma-separated entries.
function splitCell(cell: string | undefined): string[] {
  return (cell ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Extract values from sheet row columns specified by letter(s) like "F,H".
// A=0, B=1, …, Z=25.  Multiple values within one cell are comma-separated.
function getColValues(rawCols: string[], colConfig: string | null | undefined): string[] {
  if (!colConfig) return [];
  const result: string[] = [];
  for (const letter of colConfig.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) {
    if (!/^[A-Z]+$/.test(letter)) continue;
    // Multi-letter support: A=1, Z=26, AA=27, …  → 0-based index
    let idx = 0;
    for (let i = 0; i < letter.length; i++) {
      idx = idx * 26 + (letter.charCodeAt(i) - 64);
    }
    idx -= 1; // convert to 0-based
    result.push(...splitCell(rawCols[idx]));
  }
  return result;
}

// Fetch the Google Sheet as CSV and return a Map keyed by Finance ID.
// The sheet must be shared with "Anyone with the link can view".
async function fetchSheetRows(sheetUrl: string): Promise<Map<string, SheetRow>> {
  const map = new Map<string, SheetRow>();
  try {
    const csvUrl = sheetUrl
      .replace(/\/edit[^?]*(\?.*)?$/, "/export?format=csv")
      .replace(/\/pub[^?]*(\?.*)?$/, "/export?format=csv");
    const resp = await fetch(csvUrl, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      logger.warn({ status: resp.status, sheetUrl }, "Failed to fetch Google Sheet");
      return map;
    }
    const text = await resp.text();
    const lines = text.trim().split(/\r?\n/);
    // Row 0 is the header — skip it and start at row 1
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const financeId = (cols[4] ?? "").trim(); // column E (index 4) is always the Finance ID key
      if (!financeId) continue;
      map.set(financeId, { financeId, rawCols: cols });
    }
    logger.info({ rowCount: map.size }, "Google Sheet contacts loaded");
  } catch (err) {
    logger.warn({ err }, "Google Sheet fetch error");
  }
  return map;
}

// Send an email via SMTP with optional CC recipients.
async function sendEmail(opts: {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  settings: {
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpTls?: boolean | null;
    smtpUser?: string | null;
    smtpPassword?: string | null;
    smtpFrom?: string | null;
  };
}): Promise<boolean> {
  const { smtpHost, smtpPort, smtpTls, smtpUser, smtpPassword, smtpFrom } = opts.settings;
  if (!smtpHost || !smtpUser || !smtpFrom) return false;
  try {
    const port = smtpPort ?? 587;
    // Only use direct SSL/TLS when explicitly enabled; never infer from port.
    const secure = smtpTls === true;
    logger.info({ smtpHost, port, smtpTls, secure }, "sendEmail: connecting to SMTP");
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure,
      auth: smtpUser ? { user: smtpUser, pass: smtpPassword ?? "" } : undefined,
    });
    await transporter.sendMail({
      from: smtpFrom,
      to: opts.to.join(", "),
      cc: opts.cc.length ? opts.cc.join(", ") : undefined,
      subject: opts.subject,
      text: opts.text,
    });
    return true;
  } catch (err) {
    logger.warn({ err }, "SMTP send failed");
    return false;
  }
}

export async function runAlertChecks(): Promise<{
  success: boolean;
  notificationsSent: number;
  errors: string[];
  clientsChecked: number;
  details: Array<{
    metric: string;
    daysRemaining: number;
    severity: string;
    contactsNotified: number;
  }>;
}> {
  const errors: string[] = [];
  let notificationsSent = 0;
  const details: Array<{
    metric: string;
    daysRemaining: number;
    severity: string;
    contactsNotified: number;
  }> = [];

  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];
  const thresholdStaff = settings?.thresholdStaff ?? 20;
  const thresholdManager = settings?.thresholdManager ?? 15;
  const thresholdMd = settings?.thresholdMd ?? 5;
  const thresholdImmediate = settings?.thresholdImmediate ?? 1;

  // Load DB contacts as fallback (used when no sheet row matches a client).
  const dbContacts = await db.select().from(contactsTable);

  const dbStaffEmails   = dbContacts.filter(c => c.role === "staff"   && c.email).map(c => c.email as string);
  const dbManagerEmails = dbContacts.filter(c => c.role === "manager" && c.email).map(c => c.email as string);
  const dbMdEmails      = dbContacts.filter(c => c.role === "md"      && c.email).map(c => c.email as string);
  const dbStaffPhones   = dbContacts.filter(c => c.role === "staff").map(c => c.phoneNumber);
  const dbManagerPhones = dbContacts.filter(c => c.role === "manager").map(c => c.phoneNumber);
  const dbMdPhones      = dbContacts.filter(c => c.role === "md").map(c => c.phoneNumber);

  logger.info(
    { dbStaff: dbStaffEmails.length, dbManager: dbManagerEmails.length, dbMd: dbMdEmails.length },
    "DB fallback contacts loaded"
  );

  // Load Google Sheet contacts keyed by Finance ID (per-client).
  let sheetRows = new Map<string, SheetRow>();
  if (settings?.googleSheetUrl) {
    sheetRows = await fetchSheetRows(settings.googleSheetUrl);
    logger.info({ sheetRowCount: sheetRows.size }, "Sheet contacts loaded");
  }

  // Resolve To/CC emails and SMS numbers for a client by severity.
  // Prefers sheet contacts (per-client), falls back to DB contacts (global).
  function resolveContacts(financeId: string | null, severity: string): {
    toEmails: string[];
    ccEmails: string[];
    smsNumbers: string[];
  } {
    const row = financeId ? sheetRows.get(String(financeId)) : undefined;

    if (row) {
      // Use the configured column letters for this severity; fall back to sensible defaults
      const smsCols = severity === "warning"   ? (settings?.warningSmsCols    ?? "F,H")
                    : severity === "critical"   ? (settings?.criticalSmsCols   ?? "F,H,J")
                    : severity === "emergency"  ? (settings?.emergencySmsCols  ?? "F,H,J,L")
                    :                             (settings?.immediateSmsCols  ?? "F,H,J,L");
      const toCols  = severity === "warning"   ? (settings?.warningEmailToCols    ?? "G,I")
                    : severity === "critical"   ? (settings?.criticalEmailToCols   ?? "K")
                    : severity === "emergency"  ? (settings?.emergencyEmailToCols  ?? "M")
                    :                             (settings?.immediateEmailToCols  ?? "M");
      const ccCols  = severity === "warning"   ? (settings?.warningEmailCcCols    ?? "K")
                    : severity === "critical"   ? (settings?.criticalEmailCcCols   ?? "G,I,M")
                    : severity === "emergency"  ? (settings?.emergencyEmailCcCols  ?? "G,I,K")
                    :                             (settings?.immediateEmailCcCols  ?? "G,I,K");
      return {
        smsNumbers: getColValues(row.rawCols, smsCols),
        toEmails:   getColValues(row.rawCols, toCols),
        ccEmails:   getColValues(row.rawCols, ccCols),
      };
    }

    // Settings-based fallback — used when financeId is missing or not in the sheet.
    // If configured, these take priority over the DB contacts fallback.
    const splitTrimmed = (s: string | null | undefined) =>
      (s ?? "").split(",").map(v => v.trim()).filter(v => v.length > 0);

    const fbSms   = splitTrimmed(settings?.fallbackSmsNumbers);
    const fbTo    = splitTrimmed(settings?.fallbackEmailTo);
    const fbCc    = splitTrimmed(settings?.fallbackEmailCc);

    if (fbSms.length > 0 || fbTo.length > 0 || fbCc.length > 0) {
      return { smsNumbers: fbSms, toEmails: fbTo, ccEmails: fbCc };
    }

    // DB contacts fallback — used when no settings-based fallback is configured
    if (severity === "warning") {
      return { toEmails: dbStaffEmails, ccEmails: dbManagerEmails, smsNumbers: dbStaffPhones };
    } else if (severity === "critical") {
      return {
        toEmails: dbManagerEmails,
        ccEmails: [...dbStaffEmails, ...dbMdEmails],
        smsNumbers: [...dbStaffPhones, ...dbManagerPhones],
      };
    } else if (severity === "emergency") {
      return {
        toEmails: dbMdEmails,
        ccEmails: [...dbManagerEmails, ...dbStaffEmails],
        smsNumbers: [...dbMdPhones, ...dbManagerPhones, ...dbStaffPhones],
      };
    } else { // immediate
      return {
        toEmails: dbMdEmails,
        ccEmails: [...dbManagerEmails, ...dbStaffEmails],
        smsNumbers: [...dbMdPhones, ...dbManagerPhones, ...dbStaffPhones],
      };
    }
  }

  const excludedOrgsSet = new Set(
    (settings?.excludedOrgs ?? "")
      .split(",")
      .map((o) => o.trim().toLowerCase())
      .filter((o) => o.length > 0)
  );

  const rawBalances = (await fetchGrafanaBalances()).filter(
    (b) => !excludedOrgsSet.has(b.metric.trim().toLowerCase())
  );

  for (const b of rawBalances) {
    // Mirror the dashboard's logic exactly: prefer monthly avg, fall back to 7-day recent rate.
    const effectiveDaily = b.dailyConsumption > 0 ? b.dailyConsumption : b.recentDailyConsumption;
    const rawDays = effectiveDaily > 0 ? b.remainingBalance / effectiveDaily : null;
    const daysRemaining = rawDays === null ? -1 : Math.max(0, rawDays);
    const severity =
      rawDays === null
        ? "ok"
        : computeSeverity(daysRemaining, thresholdStaff, thresholdManager, thresholdMd, thresholdImmediate);

    if (severity === "ok") {
      details.push({ metric: b.metric, daysRemaining, severity, contactsNotified: 0 });
      continue;
    }

    const alertText =
      `[Balance Alert] ${severity.toUpperCase()} — Client: ${b.metric}\n` +
      `Remaining Balance: ${formatBalanceSms(b.remainingBalance)}\n` +
      `Daily Consumption: ${formatBalanceSms(effectiveDaily)}/d\n` +
      `Estimated Days Remaining: ${daysRemaining.toFixed(1)} days`;
    const subject = `[${severity.toUpperCase()}] SMS Balance Alert — ${b.metric} (${daysRemaining.toFixed(1)} days left)`;

    const { toEmails, ccEmails, smsNumbers } = resolveContacts(b.financeId, severity);
    let contactsNotified = 0;

    logger.info(
      { metric: b.metric, severity, financeId: b.financeId, sheetMatch: !!sheetRows.get(String(b.financeId ?? "")), toEmails, smsNumbers },
      "Resolved alert contacts"
    );

    // ── Email ──────────────────────────────────────────────────────────────────
    if (settings?.smtpEnabled && toEmails.length > 0) {
      logger.info({ metric: b.metric, severity, to: toEmails, cc: ccEmails }, "Sending alert email");
      const ok = await sendEmail({ to: toEmails, cc: ccEmails, subject, text: alertText, settings });
      if (ok) { notificationsSent++; contactsNotified += toEmails.length; }
      else { errors.push(`Email failed for ${b.metric} (${severity})`); }
      await db.insert(alertHistoryTable).values({
        metric: b.metric, daysRemaining, severity, channel: "email",
        recipientCount: ok ? toEmails.length : 0, success: ok,
        errorMessage: ok ? null : "SMTP send failed",
        recipients: JSON.stringify({ to: toEmails, cc: ccEmails }),
      });
    }

    // ── SMS ────────────────────────────────────────────────────────────────────
    if (settings?.smsEnabled && smsNumbers.length > 0) {
      let smsSuccess = 0;
      const smsErrors: string[] = [];
      for (const phoneNumber of smsNumbers) {
        const result = await sendSmsNotification(phoneNumber, alertText, settings);
        if (result.ok) { smsSuccess++; notificationsSent++; contactsNotified++; }
        else {
          const errDetail = result.error ?? "Unknown error";
          errors.push(`SMS failed for ${phoneNumber}: ${errDetail}`);
          smsErrors.push(`${phoneNumber}: ${errDetail}`);
        }
      }
      await db.insert(alertHistoryTable).values({
        metric: b.metric, daysRemaining, severity, channel: "sms",
        recipientCount: smsSuccess, success: smsSuccess > 0,
        errorMessage: smsErrors.length > 0 ? smsErrors.join(" | ") : null,
        recipients: JSON.stringify({ numbers: smsNumbers }),
      });
    }

    // ── Telegram ───────────────────────────────────────────────────────────────
    if (settings?.telegramEnabled) {
      const ok = await sendTelegramNotification(alertText, settings);
      if (ok) notificationsSent++;
      await db.insert(alertHistoryTable).values({
        metric: b.metric, daysRemaining, severity, channel: "telegram",
        recipientCount: ok ? 1 : 0, success: ok,
        errorMessage: ok ? null : "Telegram send failed",
        recipients: JSON.stringify({ chatId: settings?.telegramChatId ?? "broadcast" }),
      });
    }

    details.push({ metric: b.metric, daysRemaining, severity, contactsNotified });
  }

  return {
    success: true,
    notificationsSent,
    errors,
    clientsChecked: rawBalances.length,
    details,
  };
}

router.post("/alerts/trigger", async (req, res): Promise<void> => {
  req.log.info("Manual alert trigger requested");
  const result = await runAlertChecks();
  res.json(result);
});

export async function refreshBalanceCache(): Promise<void> {
  const rows = await db.select().from(settingsTable).limit(1);
  const settings = rows[0];
  const thresholdStaff = settings?.thresholdStaff ?? 20;
  const thresholdManager = settings?.thresholdManager ?? 15;
  const thresholdMd = settings?.thresholdMd ?? 5;
  const thresholdImmediate = settings?.thresholdImmediate ?? 1;

  const excludedOrgsSet = new Set(
    (settings?.excludedOrgs ?? "")
      .split(",")
      .map((o) => o.trim().toLowerCase())
      .filter((o) => o.length > 0)
  );

  const rawBalances = (await fetchGrafanaBalances()).filter(
    (b) => !excludedOrgsSet.has(b.metric.trim().toLowerCase())
  );

  const { updateBalanceCache } = await import("../lib/balanceCache.js");
  updateBalanceCache(
    rawBalances.map((b) => {
      const effectiveDaily = b.dailyConsumption > 0 ? b.dailyConsumption : b.recentDailyConsumption;
      const rawDays = effectiveDaily > 0 ? b.remainingBalance / effectiveDaily : null;
      const daysRemaining = rawDays === null ? -1 : Math.max(0, Math.round(rawDays * 10) / 10);
      const severity = rawDays === null ? "ok" : computeSeverity(daysRemaining, thresholdStaff, thresholdManager, thresholdMd, thresholdImmediate);
      return { metric: b.metric, remainingBalance: b.remainingBalance, daysRemaining, severity, financeId: b.financeId ?? null };
    })
  );
}

export default router;
