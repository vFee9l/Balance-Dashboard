import { Router } from "express";
import { sql } from "drizzle-orm";
import { db, settingsTable, alertHistoryTable, contactsTable, clientDailyConsumptionTable } from "@workspace/db";
import { logger } from "../lib/logger";
import nodemailer from "nodemailer";

const router = Router();

interface ClientBalanceData {
  metric: string;
  remainingBalance: number;
  dailyConsumption: number;
  recentDailyConsumption: number;
  yesterdayConsumption: number;
  dayBeforeConsumption: number | null;
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
    )
  `;

  // Query A: Most recent remaining balance per org — uses BalanceHistory-Hour for live data.
  // Takes the latest hourly snapshot per org (ROW_NUMBER rn=1), matching exactly what
  // the Grafana stat panel shows.
  const balanceSql = `
    WITH ${orgConfigCte},
    Latest AS (
      SELECT
        o.name AS metric,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Remaining_Balance,
        ROW_NUMBER() OVER (PARTITION BY o.name ORDER BY b.CreatedDate DESC) AS rn
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Hour] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE b.CreatedDate >= DATEADD(day, -2, GETDATE())
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    )
    SELECT metric, Remaining_Balance
    FROM Latest
    WHERE rn = 1
    ORDER BY metric
  `;

  // Query B: Average daily consumption using the same calendar period from the previous month.
  //
  // Rationale: SMS traffic is not uniform — clients such as banks have heavy payroll traffic
  // on fixed day ranges each month (e.g. 26th–30th). Using a simple 30-day average would
  // underestimate consumption during those peaks (or overestimate outside them).
  //
  // Instead we look at the equivalent day range in the PREVIOUS month:
  //   • Start : 1st of last month
  //   • End   : same day-of-month as today, but in last month
  //             (e.g. today = May 28  →  window = Apr 1 – Apr 28)
  //
  // This means the daily average naturally includes any payroll spike that occurred during
  // that same period last month, giving a much more accurate estimate of days remaining.
  // Query B: Average daily consumption over the full previous calendar month.
  // Using the full previous month (1st to last day) avoids the edge case on the 1st of the
  // month where "same day last month" collapses the window to a single day and LAG produces
  // no pairs. EOMONTH gives the last day of last month reliably.
  const consumptionSql = `
    WITH ${orgConfigCte},
    DailyData AS (
      SELECT
        o.name AS metric,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Balance,
        LAG(
          CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END
        ) OVER (PARTITION BY o.name ORDER BY b.CreatedDate ASC) AS Prev_Balance
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Daily] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE
        -- Full previous calendar month: 1st to last day
        b.CreatedDate >= DATEFROMPARTS(
          YEAR(DATEADD(month, -1, CAST(GETDATE() AS DATE))),
          MONTH(DATEADD(month, -1, CAST(GETDATE() AS DATE))),
          1
        )
        AND b.CreatedDate <= EOMONTH(DATEADD(month, -1, CAST(GETDATE() AS DATE)))
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    )
    SELECT
      metric,
      AVG(CAST(CASE WHEN (Prev_Balance - Balance) > 0 THEN (Prev_Balance - Balance) ELSE 0 END AS FLOAT)) AS Avg_Daily_Consumption
    FROM DailyData
    WHERE Prev_Balance IS NOT NULL
    GROUP BY metric
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

  // Query C: Recent 7-day rolling average of daily consumption.
  // Used for the tooltip comparison — shows "at current burn rate, X days left".
  // Useful to contrast with the payroll-period rate from Query B.
  const recentConsumptionSql = `
    WITH ${orgConfigCte},
    DailyData AS (
      SELECT
        o.name AS metric,
        CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END AS Balance,
        LAG(
          CASE WHEN oc.id IS NOT NULL THEN b.TotalOrganizationBalance ELSE b.TotalUserBalance END
        ) OVER (PARTITION BY o.name ORDER BY b.CreatedDate ASC) AS Prev_Balance
      FROM [RiCH-Web-2].[dbo].[BalanceHistory-Daily] b
      JOIN [RiCH-Web].[dbo].[Organisation] o ON o.id = b.id
      LEFT JOIN OrgConfig oc ON oc.id = o.id
      WHERE b.CreatedDate >= DATEADD(day, -8, CAST(GETDATE() AS DATE))
        AND b.CreatedDate <= CAST(GETDATE() AS DATE)
        AND o.Status = 1
        AND o.FinanceAccountId NOT IN (508, 820, 906, 507, 1003, 552, 553, '', 534)
    )
    SELECT
      metric,
      AVG(CAST(CASE WHEN (Prev_Balance - Balance) > 0 THEN (Prev_Balance - Balance) ELSE 0 END AS FLOAT)) AS Avg_Daily_Consumption_Recent
    FROM DailyData
    WHERE Prev_Balance IS NOT NULL
    GROUP BY metric
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
        rawSql: consumptionSql,
        format: "table",
        rawQuery: true,
        dataset: "reportag4-25",
      },
      {
        refId: "C",
        datasource: { type: "mssql", uid: "af0fc2y09shdsd" },
        rawSql: recentConsumptionSql,
        format: "table",
        rawQuery: true,
        dataset: "reportag4-25",
      },
      {
        refId: "D",
        datasource: { type: "mssql", uid: "af0fc2y09shdsd" },
        rawSql: dayOverDaySql,
        format: "table",
        rawQuery: true,
        dataset: "reportag4-25",
      },
    ],
    from: "now-65d",
    to: "now",
  };

  try {
    const resp = await fetch(`${grafanaUrl}/api/ds/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, url: grafanaUrl }, "Grafana query failed");
      return [];
    }

    const data = (await resp.json()) as GrafanaQueryResponse;
    const balanceFrames = data?.results?.A?.frames ?? [];
    const consumptionFrames = data?.results?.B?.frames ?? [];
    const recentConsumptionFrames = data?.results?.C?.frames ?? [];
    const dayOverDayFrames = data?.results?.D?.frames ?? [];

    if (balanceFrames.length === 0) {
      logger.warn("Grafana returned no balance frames");
      return [];
    }

    return parseFramesToBalances(balanceFrames, consumptionFrames, recentConsumptionFrames, dayOverDayFrames);
  } catch (err) {
    logger.error({ err }, "Grafana fetch error");
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

function parseFramesToBalances(
  balanceFrames: GrafanaFrame[],
  consumptionFrames: GrafanaFrame[],
  recentConsumptionFrames: GrafanaFrame[],
  dayOverDayFrames: GrafanaFrame[]
): ClientBalanceData[] {
  // Build balance map: metric → latest remaining balance
  const balanceMap = extractFrameMap(balanceFrames, "metric", "Remaining_Balance");

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
    const recentDailyConsumption = recentConsumptionMap.get(metric) ?? 0;
    const yesterdayConsumption = yesterdayMap.get(metric) ?? 0;
    const dayBeforeRaw = dayBeforeMap.get(metric);
    const dayBeforeConsumption = dayBeforeRaw !== undefined ? dayBeforeRaw : null;
    result.push({ metric, remainingBalance, dailyConsumption, recentDailyConsumption, yesterdayConsumption, dayBeforeConsumption });
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

function computeSeverity(
  daysRemaining: number,
  thresholdStaff: number,
  thresholdManager: number,
  thresholdMd: number
): string {
  if (daysRemaining < thresholdMd) return "emergency";
  if (daysRemaining < thresholdManager) return "critical";
  if (daysRemaining < thresholdStaff) return "warning";
  return "ok";
}

function buildSmsBody(template: string | null | undefined, phone: string, message: string): string {
  if (!template) return JSON.stringify({ to: phone, message });
  return template
    .replace(/\{phone\}/g, phone)
    .replace(/\{to\}/g, phone)
    .replace(/\{number\}/g, phone)
    .replace(/\{message\}/g, message)
    .replace(/\{text\}/g, message);
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

  const rawBalances = await fetchGrafanaBalances();

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
        : computeSeverity(daysRemaining, thresholdStaff, thresholdManager, thresholdMd);

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

  res.json(result);
});

async function sendSmsNotification(
  phoneNumber: string,
  message: string,
  settings: {
    smsApiUrl?: string | null;
    smsBodyTemplate?: string | null;
  }
): Promise<boolean> {
  if (!settings.smsApiUrl) return false;
  try {
    const rawBody = buildSmsBody(settings.smsBodyTemplate, phoneNumber, message);

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }

    const isJson = typeof parsedBody === "object";
    const resp = await fetch(settings.smsApiUrl, {
      method: "POST",
      headers: { "Content-Type": isJson ? "application/json" : "text/plain" },
      body: isJson ? JSON.stringify(parsedBody) : rawBody,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, phoneNumber }, "SMS API returned error");
    }
    return resp.ok;
  } catch (err) {
    logger.warn({ err, phoneNumber }, "SMS send failed");
    return false;
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
interface SheetContact {
  name: string;
  email: string;
  clientName: string;
  ccs: string[];       // Account Manager/Director emails to CC
}

// Fetch contacts from a public Google Sheet (CSV export).
// Expected columns: Name, Phone, Email  (test sheet)
// Real sheet columns: Client Name, CCS, Account Manager/Director, ...
// The function normalises both layouts by detecting column headers.
async function fetchSheetContacts(sheetUrl: string): Promise<SheetContact[]> {
  try {
    // Convert edit URL → CSV export URL
    const csvUrl = sheetUrl
      .replace(/\/edit.*$/, "/export?format=csv")
      .replace(/\/pub.*$/, "/export?format=csv");
    const resp = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      logger.warn({ status: resp.status, sheetUrl }, "Failed to fetch Google Sheet");
      return [];
    }
    const text = await resp.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    // Parse a CSV line respecting quoted fields
    const parseCsvLine = (line: string): string[] => {
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
    };

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const contacts: SheetContact[] = [];

    // Detect layout
    const nameIdx = headers.findIndex((h) => h === "name" || h.includes("client"));
    const emailIdx = headers.findIndex((h) => h === "email" || h.includes("ccs") || h.includes("account manager"));
    const ccIdx = headers.findIndex((h) => h.includes("account manager") || h.includes("director"));

    if (nameIdx === -1 || emailIdx === -1) {
      logger.warn({ headers }, "Google Sheet has unexpected column layout");
      return [];
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const name = cols[nameIdx]?.trim() ?? "";
      const email = cols[emailIdx]?.trim() ?? "";
      const cc = ccIdx !== -1 ? (cols[ccIdx]?.trim() ?? "") : "";
      if (!name && !email) continue;
      contacts.push({
        name,
        email,
        clientName: name,
        ccs: cc ? cc.split(/[;,\s]+/).filter(Boolean) : [],
      });
    }

    return contacts;
  } catch (err) {
    logger.warn({ err }, "Google Sheet fetch error");
    return [];
  }
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
    smtpUser?: string | null;
    smtpPassword?: string | null;
    smtpFrom?: string | null;
  };
}): Promise<boolean> {
  const { smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom } = opts.settings;
  if (!smtpHost || !smtpUser || !smtpFrom) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort ?? 587,
      secure: (smtpPort ?? 587) === 465,
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

  // Fixed manager and MD emails
  const managerEmails = ["a.aljarba@t2.sa", "b.alabsi@t2.sa"];
  const mdEmails = ["n.ghnaim@t2.sa"];

  // Fetch Google Sheet contacts (staff per client)
  const sheetContacts: SheetContact[] = settings?.googleSheetUrl
    ? await fetchSheetContacts(settings.googleSheetUrl)
    : [];

  // Also fall back to DB contacts for SMS
  const dbContacts = await db.select().from(contactsTable);

  const rawBalances = await fetchGrafanaBalances();

  for (const b of rawBalances) {
    const rawDays =
      b.dailyConsumption > 0 ? b.remainingBalance / b.dailyConsumption : null;
    const daysRemaining = rawDays === null ? -1 : Math.max(0, rawDays);
    const severity =
      rawDays === null
        ? "ok"
        : computeSeverity(daysRemaining, thresholdStaff, thresholdManager, thresholdMd);

    if (severity === "ok") {
      details.push({ metric: b.metric, daysRemaining, severity, contactsNotified: 0 });
      continue;
    }

    const balanceMil = (b.remainingBalance / 1_000_000).toFixed(2);
    const consumptionMil = (b.dailyConsumption / 1_000_000).toFixed(2);
    const alertText =
      `[Balance Alert] ${severity.toUpperCase()} — Client: ${b.metric}\n` +
      `Remaining Balance: ${balanceMil}M\n` +
      `Daily Consumption: ${consumptionMil}M\n` +
      `Estimated Days Remaining: ${daysRemaining.toFixed(1)} days`;
    const subject = `[${severity.toUpperCase()}] SMS Balance Alert — ${b.metric} (${daysRemaining.toFixed(1)} days left)`;

    let contactsNotified = 0;

    // ── Email logic ────────────────────────────────────────────────────────────
    // Find the CCS + Account Manager emails for this client from the sheet
    const clientSheet = sheetContacts.find(
      (s) => s.clientName.toLowerCase() === b.metric.toLowerCase()
    );
    const staffEmails = clientSheet
      ? [clientSheet.email, ...clientSheet.ccs].filter(Boolean)
      : [];

    if (settings?.smtpEnabled) {
      let toEmails: string[] = [];
      let ccEmails: string[] = [];

      if (severity === "warning") {
        // Warning: To = staff (CCS + AM/Director)
        toEmails = staffEmails;
        ccEmails = [];
      } else if (severity === "critical") {
        // Critical: To = managers, CC = staff
        toEmails = managerEmails;
        ccEmails = staffEmails;
      } else if (severity === "emergency") {
        // Emergency: To = MD, CC = managers + staff
        toEmails = mdEmails;
        ccEmails = [...managerEmails, ...staffEmails];
      }

      if (toEmails.length > 0) {
        const ok = await sendEmail({
          to: toEmails,
          cc: ccEmails,
          subject,
          text: alertText,
          settings,
        });
        if (ok) {
          notificationsSent++;
          contactsNotified += toEmails.length;
        } else {
          errors.push(`Email failed for ${b.metric} (${severity})`);
        }
        await db.insert(alertHistoryTable).values({
          metric: b.metric,
          daysRemaining,
          severity,
          channel: "email",
          recipientCount: ok ? toEmails.length : 0,
          success: ok,
          errorMessage: ok ? null : "SMTP send failed",
        });
      }
    }

    // ── SMS logic (DB contacts, role-based) ───────────────────────────────────
    if (settings?.smsEnabled) {
      let eligibleContacts = dbContacts;
      if (severity === "critical") {
        eligibleContacts = dbContacts.filter((c) => c.role === "manager" || c.role === "md");
      } else if (severity === "emergency") {
        eligibleContacts = dbContacts.filter((c) => c.role === "md");
      }

      if (eligibleContacts.length > 0) {
        let smsSuccess = 0;
        for (const contact of eligibleContacts) {
          const ok = await sendSmsNotification(contact.phoneNumber, alertText, settings);
          if (ok) { smsSuccess++; notificationsSent++; contactsNotified++; }
          else { errors.push(`SMS failed for ${contact.fullName} (${contact.phoneNumber})`); }
        }
        await db.insert(alertHistoryTable).values({
          metric: b.metric,
          daysRemaining,
          severity,
          channel: "sms",
          recipientCount: smsSuccess,
          success: smsSuccess > 0,
          errorMessage: smsSuccess === 0 ? "All SMS sends failed" : null,
        });
      }
    }

    // ── Telegram ──────────────────────────────────────────────────────────────
    if (settings?.telegramEnabled) {
      const ok = await sendTelegramNotification(alertText, settings);
      if (ok) notificationsSent++;
      await db.insert(alertHistoryTable).values({
        metric: b.metric,
        daysRemaining,
        severity,
        channel: "telegram",
        recipientCount: ok ? 1 : 0,
        success: ok,
        errorMessage: ok ? null : "Telegram send failed",
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

export default router;
