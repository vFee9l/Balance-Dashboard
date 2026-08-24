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
    historyFrames: [history],
    metric: "AlRajhi",
    fetchedAt: fetchWindow,
  });

  assert.ok(study);
  assert.equal(study.remainingBalance, 1_234_567.89);
  assert.equal(study.lastUpdated, fetchWindow);
  assert.equal(study.coverageDays, 90);
  assert.equal(study.rateWindowDays, 90);
  assert.equal(study.rateBasis, "90-day average");
  assert.equal(study.averageDailyConsumption, 125);
  assert.deepEqual(study.dataQuality, []);
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
  assert.deepEqual(study.dataQuality, [
    "2 partial hierarchy day(s) were excluded from the consumption forecast.",
    "Only 0 days of usable history are available.",
    "No positive consumption rate can be calculated from the available history.",
  ]);
});