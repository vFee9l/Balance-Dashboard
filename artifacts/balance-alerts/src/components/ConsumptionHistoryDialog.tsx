import { useState } from "react";
import {
  useGetConsumptionHistory,
  getGetConsumptionHistoryQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ConsumptionHistoryDialogProps {
  metric: string | null;
  severity: string;
  onClose: () => void;
}

const chartConfig = {
  previousMonth: {
    label: "Previous Month",
    color: "hsl(var(--chart-2))",
  },
  currentMonth: {
    label: "This Month",
    color: "hsl(var(--chart-1))",
  },
} as const;

function formatM(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + "K";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function ConsumptionHistoryDialog({
  metric,
  severity,
  onClose,
}: ConsumptionHistoryDialogProps) {
  const { data, isLoading, isError } = useGetConsumptionHistory(
    { metric: metric ?? "" },
    {
      query: {
        queryKey: getGetConsumptionHistoryQueryKey({ metric: metric ?? "" }),
        enabled: !!metric,
      },
    }
  );

  const getSeverityBadgeClass = (s: string) => {
    switch (s.toLowerCase()) {
      case "ok": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "warning": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "critical": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "emergency": return "bg-red-900/40 text-red-400 border-red-500/40";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const chartData = (() => {
    if (!data) return [];
    const days = new Map<number, { day: number; previousMonth?: number; currentMonth?: number }>();
    for (const pt of data.previousMonth) {
      days.set(pt.day, { day: pt.day, previousMonth: pt.consumption });
    }
    for (const pt of data.currentMonth) {
      const existing = days.get(pt.day) ?? { day: pt.day };
      days.set(pt.day, { ...existing, currentMonth: pt.consumption });
    }
    return Array.from(days.values()).sort((a, b) => a.day - b.day);
  })();

  const prevAvg = data && data.previousMonth.length > 0
    ? data.previousMonth.reduce((s, p) => s + p.consumption, 0) / data.previousMonth.length
    : 0;
  const currAvg = data && data.currentMonth.length > 0
    ? data.currentMonth.reduce((s, p) => s + p.consumption, 0) / data.currentMonth.length
    : null;

  const trend = currAvg !== null
    ? currAvg > prevAvg * 1.1 ? "up"
      : currAvg < prevAvg * 0.9 ? "down"
      : "flat"
    : null;

  return (
    <Dialog open={!!metric} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl bg-card border-border/50">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle className="font-mono text-lg">{metric}</DialogTitle>
            <Badge
              variant="outline"
              className={`uppercase tracking-wider font-bold text-xs ${getSeverityBadgeClass(severity)}`}
            >
              {severity}
            </Badge>
            {trend === "up" && (
              <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                <TrendingUp className="w-3.5 h-3.5" /> Higher than last month
              </span>
            )}
            {trend === "down" && (
              <span className="flex items-center gap-1 text-xs text-green-400 font-medium">
                <TrendingDown className="w-3.5 h-3.5" /> Lower than last month
              </span>
            )}
            {trend === "flat" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                <Minus className="w-3.5 h-3.5" /> Similar to last month
              </span>
            )}
          </div>
          <DialogDescription className="text-muted-foreground text-xs mt-1">
            Daily SMS consumption — {data?.currentMonthLabel ?? "This Month"} vs {data?.previousMonthLabel ?? "Previous Month"} (same period)
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3 py-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-destructive text-sm py-8 justify-center">
            <AlertCircle className="w-4 h-4" />
            Failed to load consumption history.
          </div>
        )}

        {data && !isLoading && (
          <div className="space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Prev. Month Avg/Day</p>
                <p className="text-sm font-bold font-mono">{formatM(prevAvg)}</p>
                <p className="text-xs text-muted-foreground">{data.previousMonthLabel}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">This Month Avg/Day</p>
                <p className="text-sm font-bold font-mono">
                  {currAvg !== null ? formatM(currAvg) : <span className="text-muted-foreground">—</span>}
                </p>
                <p className="text-xs text-muted-foreground">{data.currentMonthLabel}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Peak Day (Prev. Mo.)</p>
                <p className="text-sm font-bold font-mono">
                  {data.previousMonth.length > 0
                    ? `Day ${data.previousMonth.reduce((max, p) => p.consumption > max.consumption ? p : max).day}`
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.previousMonth.length > 0
                    ? formatM(data.previousMonth.reduce((max, p) => p.consumption > max.consumption ? p : max).consumption)
                    : ""}
                </p>
              </div>
            </div>

            {/* Bar chart */}
            {chartData.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-64 w-full">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    label={{ value: "Day of Month", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => formatM(v)}
                    width={56}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(label) => `Day ${label}`}
                        formatter={(value, name) => [formatM(Number(value)), name]}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {prevAvg > 0 && (
                    <ReferenceLine
                      y={prevAvg}
                      stroke="hsl(var(--chart-2))"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                  )}
                  <Bar dataKey="previousMonth" fill="var(--color-previousMonth)" radius={[2, 2, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="currentMonth" fill="var(--color-currentMonth)" radius={[2, 2, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                No consumption data available for this period.
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              The dashed line shows the previous month's average. Bars represent daily SMS sent.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
