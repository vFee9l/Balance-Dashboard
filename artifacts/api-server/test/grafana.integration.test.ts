import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrganizationStudy,
  parseFramesToBalances,
  type GrafanaFrame,
} from "../src/routes/grafanaData.ts";

const fetchWindow = "2026-08-24T09:15:00.000Z";

function frame(fields: string[], values: unknown[][]): GrafanaFrame {
  return {
    schema: { fields: fields.map((name) => ({ name, type: "string" })) },
    data: { values },
  };
}

const calculatedSummary = frame(
  ["metric", "finance_id", "uses_org_balance", "Remaining_Balance"],
  [
    ["AlRajhi", "AlRajhi"],
    ["1031", "1031"],
    [1, 1],
    [1_234_567.89, 1_234_567.89],
  ],
);

const hierarchyRatesIncludingChild = frame(
  [
    "metric",
    "Avg_Daily_Consumption",
    "Avg_Daily_Consumption_Recent",
    "yesterday_consumption",
    "day_before_consumption",
  ],
  [
    ["AlRajhi", "AlRajhi - child balance"],
    [125, 40],
    [130, 40],
    [120, 40],
    [110, 40],
  ],
);

const alRajhiChildren = frame(
  [
    "organization_id",
    "metric",
    "finance_id",
    "parent_organization_id",
    "organization_level",
    "uses_org_balance",
    "Remaining_Balance",
  ],
  [
    ["alrajhi-child-1", "alrajhi-child-2"],
    ["AlRajhi-1", "AlRajhi-2"],
    ["1032", null],
    ["alrajhi-parent", "alrajhi-parent"],
    ["sub", "sub"],
    [1, 0],
    [900_000, 334_567.89],
  ],
);

test("calculated hierarchy summary produces one AlRajhi alert target", () => {
  const monitoringFeed = parseFramesToBalances(
    [calculatedSummary],
    [hierarchyRatesIncludingChild],
    [hierarchyRatesIncludingChild],
    [hierarchyRatesIncludingChild],
    fetchWindow,
  );

  assert.equal(
    monitoringFeed.filter((entry) => entry.metric === "AlRajhi").length,
    1,
    "duplicate summary rows must not result in duplicate alerts",
  );
  assert.equal(
    monitoringFeed.some((entry) => entry.metric === "AlRajhi - child balance"),
    false,
    "a hierarchy child in a consumption panel must never become an alert target",
  );

  const alRajhi = monitoringFeed.find((entry) => entry.metric === "AlRajhi");
  assert.deepEqual(alRajhi, {
    metric: "AlRajhi",
    financeId: "1031",
    remainingBalance: 1_234_567.89,
    dailyConsumption: 125,
    recentDailyConsumption: 130,
    yesterdayConsumption: 120,
    dayBeforeConsumption: 110,
    lastUpdated: fetchWindow,
  });
});

test("organization study uses the calculated summary balance with populated 90-day history", () => {
  const start = Date.UTC(2026, 4, 27);
  const history = frame(
    ["date", "balance", "consumption", "is_complete"],
    [
      Array.from({ length: 90 }, (_, day) => new Date(start + day * 86_400_000).toISOString()),
      Array.from({ length: 90 }, (_, day) => 1_245_817.89 - day * 125),
      Array.from({ length: 90 }, () => 125),
      Array.from({ length: 90 }, () => 1),
    ],
  );

  const study = buildOrganizationStudy({
    summaryFrames: [calculatedSummary],
    childFrames: [alRajhiChildren],
    historyFrames: [history],
    metric: "AlRajhi",
    fetchedAt: fetchWindow,
  });

  assert.ok(study);
  assert.equal(study.remainingBalance, 1_234_567.89);
  assert.equal(study.lastUpdated, fetchWindow);
  assert.equal(study.coverageDays, 90);
  assert.equal(study.rateWindowDays, 90);
  assert.equal(study.rateBasis, "90-day average (90 valid daily intervals)");
  assert.equal(study.averageDailyConsumption, 125);
  assert.deepEqual(study.dataQuality, []);
  assert.deepEqual(study.children, [
    {
      organizationId: "alrajhi-child-1",
      metric: "AlRajhi-1",
      financeId: "1032",
      parentOrganizationId: "alrajhi-parent",
      organizationLevel: "sub",
      usesOrgBalance: true,
      remainingBalance: 900_000,
    },
    {
      organizationId: "alrajhi-child-2",
      metric: "AlRajhi-2",
      financeId: null,
      parentOrganizationId: "alrajhi-parent",
      organizationLevel: "sub",
      usesOrgBalance: false,
      remainingBalance: 334_567.89,
    },
  ]);
});

test("organization study reports missing hierarchy history as a data-quality state", () => {
  const partialHistory = frame(
    ["date", "balance", "consumption", "is_complete"],
    [
      ["2026-08-22T00:00:00.000Z", "2026-08-23T00:00:00.000Z"],
      [1_245_817.89, 1_245_692.89],
      [125, 125],
      [0, 0],
    ],
  );

  const study = buildOrganizationStudy({
    summaryFrames: [calculatedSummary],
    childFrames: [],
    historyFrames: [partialHistory],
    metric: "AlRajhi",
    fetchedAt: fetchWindow,
  });

  assert.ok(study);
  assert.equal(study.remainingBalance, 1_234_567.89);
  assert.equal(study.lastUpdated, fetchWindow);
  assert.equal(study.coverageDays, 0);
  assert.equal(study.averageDailyConsumption, 0);
  assert.equal(study.daysRemaining, -1);
  assert.equal(study.rateBasis, "Insufficient daily history");
  assert.deepEqual(study.children, []);
  assert.deepEqual(study.dataQuality, [
    "2 partial hierarchy day(s) were excluded from the consumption forecast.",
    "Only 0 days of usable history are available.",
    "No forecast is shown because the full hierarchy has no complete consecutive daily consumption window.",
  ]);
});

test("organization study never combines separate history runs for a forecast", () => {
  const firstRunDays = Array.from({ length: 60 }, (_, day) => new Date(Date.UTC(2026, 5, 1 + day)).toISOString());
  const latestRunDays = Array.from({ length: 4 }, (_, day) => new Date(Date.UTC(2026, 7, 2 + day)).toISOString());
  const fragmentedHistory = frame(
    ["date", "balance", "consumption", "is_complete"],
    [
      [...firstRunDays, ...latestRunDays],
      Array.from({ length: 64 }, (_, day) => 1_245_817.89 - day * 125),
      [...Array.from({ length: 60 }, () => 125), ...Array.from({ length: 4 }, () => 500)],
      Array.from({ length: 64 }, () => 1),
    ],
  );

  const study = buildOrganizationStudy({
    summaryFrames: [calculatedSummary],
    childFrames: [],
    historyFrames: [fragmentedHistory],
    metric: "AlRajhi",
    fetchedAt: fetchWindow,
  });

  assert.ok(study);
  assert.equal(study.coverageDays, 4);
  assert.equal(study.averageDailyConsumption, 0);
  assert.equal(study.daysRemaining, -1);
  assert.deepEqual(study.dataQuality, [
    "60 older or non-consecutive daily interval(s) were excluded from the consumption forecast.",
    "Only 4 days of usable history are available.",
    "No forecast is shown because the full hierarchy has no complete consecutive daily consumption window.",
  ]);
});