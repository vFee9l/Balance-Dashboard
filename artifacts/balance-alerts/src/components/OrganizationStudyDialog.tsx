import {
  useGetGrafanaOrganizationStudy,
  useListGrafanaOrganizations,
  getGetGrafanaOrganizationStudyQueryKey,
  getListGrafanaOrganizationsQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { AlertCircle, CalendarDays, Gauge, Landmark, Network, TrendingDown, TrendingUp, Search } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

interface OrganizationStudyDialogProps {
  metric: string | null;
  fallbackSeverity: string;
  onClose: () => void;
  onSelectMetric: (metric: string) => void;
}

const chartConfig = {
  consumption: {
    label: "Daily consumption",
    color: "hsl(var(--primary))",
  },
} as const;

function formatValue(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatExactValue(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getSeverityStyles(severity: string) {
  switch (severity.toLowerCase()) {
    case "ok":
      return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" };
    case "warning":
      return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" };
    case "critical":
      return { text: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/30" };
    case "emergency":
      return { text: "text-pink-500", bg: "bg-pink-600/20", border: "border-pink-500/40" };
    case "immediate":
      return { text: "text-purple-400", bg: "bg-purple-600/20", border: "border-purple-500/40" };
    default:
      return { text: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" };
  }
}

export default function OrganizationStudyDialog({
  metric,
  fallbackSeverity,
  onClose,
  onSelectMetric,
}: OrganizationStudyDialogProps) {
  const { data: organizations, isLoading: isLoadingOrganizations } = useListGrafanaOrganizations({
    query: {
      enabled: !!metric,
      staleTime: 60_000,
      queryKey: getListGrafanaOrganizationsQueryKey(),
    },
  });
  const {
    data: study,
    isLoading: isLoadingStudy,
    isError,
  } = useGetGrafanaOrganizationStudy(
    { metric: metric ?? "" },
    {
      query: {
        enabled: !!metric,
        queryKey: getGetGrafanaOrganizationStudyQueryKey({ metric: metric ?? "" }),
      },
    },
  );

  const organizationList = Array.isArray(organizations) ? organizations : [];
  const displayedSeverity = study?.severity ?? fallbackSeverity;
  const sevStyles = getSeverityStyles(displayedSeverity);
  const chartData = study?.dailyHistory.map((point) => ({
    ...point,
    label: formatDate(point.date),
  })) ?? [];
  const historyRows = [...(study?.dailyHistory ?? [])].reverse();
  const childRows = study?.children ?? [];

  return (
    <Dialog open={!!metric} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-[90rem] overflow-y-auto rounded-lg border-border bg-background p-0 shadow-2xl scanlines [&>button]:z-20">
        {/* Header Ribbon */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border p-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-3">
              <div className="h-6 w-1 bg-primary rounded-full shadow-[0_0_10px_rgba(var(--primary),0.6)]" />
              <span className="font-mono text-xl tracking-tight text-foreground">BALANCE DETAIL</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Review Grafana-aligned balance, consumption, forecast, and daily history for the selected organization.
            </DialogDescription>
            <div className={`px-3 py-1 text-[11px] font-mono font-bold tracking-widest uppercase rounded border ${sevStyles.bg} ${sevStyles.border} ${sevStyles.text} shadow-[inset_0_0_15px_rgba(0,0,0,0.5)]`}>
              STATUS: {displayedSeverity}
            </div>
          </div>

          <div className="flex items-center gap-3 w-full max-w-sm">
            <Select value={metric ?? ""} onValueChange={onSelectMetric}>
              <SelectTrigger className="bg-card/50 border-border/60 hover:border-primary/40 font-mono text-sm h-10 transition-colors">
                <Search className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select target node" />
              </SelectTrigger>
              <SelectContent>
                {isLoadingOrganizations ? (
                  <SelectItem value="loading" disabled className="font-mono text-xs">Loading network map…</SelectItem>
                ) : (
                  organizationList.map((organization) => (
                    <SelectItem key={organization.metric} value={organization.metric} className="font-mono text-xs">
                      {organization.metric}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="p-6">
          {isLoadingStudy && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 bg-card/50" />)}
              </div>
              <Skeleton className="h-[300px] w-full bg-card/50" />
            </div>
          )}

          {isError && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center border border-dashed border-rose-500/30 bg-rose-500/5 rounded-lg m-4">
              <div className="h-12 w-12 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
                <AlertCircle className="h-6 w-6 text-rose-500" />
              </div>
              <div>
                <p className="font-bold text-rose-400 tracking-wide">TELEMETRY LINK FAILED</p>
                <p className="text-sm text-rose-500/60 mt-1 font-mono">Unable to retrieve node data payload. Verify external connection.</p>
              </div>
            </div>
          )}

          {study && !isLoadingStudy && (
            <div className="space-y-6">
              {/* Primary Readouts */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-border/50 bg-card/40">
                  <CardContent className="p-5">
                    <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase flex items-center gap-2 mb-3">
                      <Landmark className="h-3.5 w-3.5 text-primary/70" /> Finance Account ID
                    </p>
                    <p className="font-mono text-2xl text-foreground">
                      {study.financeId && Number(study.financeId) > 0 ? study.financeId : <span className="opacity-30">NULL</span>}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-border/50 bg-card/40">
                  <CardContent className="p-5">
                    <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase flex items-center gap-2 mb-3">
                      <Gauge className="h-3.5 w-3.5 text-primary/70" /> Shared Balance Pool
                    </p>
                    <p className={`font-mono text-2xl font-bold ${study.usesOrgBalance ? "text-emerald-400" : "text-muted-foreground/50"}`}>
                      {study.usesOrgBalance ? "TRUE" : "FALSE"}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-primary/30 bg-primary/10 sm:col-span-2 relative overflow-hidden shadow-[inset_0_0_20px_rgba(var(--primary),0.05)]">
                  <div className="absolute right-0 bottom-0 p-4 opacity-[0.03]">
                    <TrendingDown className="w-24 h-24 text-primary" />
                  </div>
                  <CardContent className="p-5 relative z-10">
                    <p className="text-[11px] font-bold tracking-widest text-primary/80 uppercase flex items-center gap-2 mb-2">
                      <TrendingDown className="h-4 w-4" /> Available Balance
                    </p>
                    <p className={`font-mono text-4xl font-bold tracking-tight ${study.remainingBalance < 0 ? "text-rose-400" : "text-foreground"}`}>
                      {formatExactValue(study.remainingBalance)}
                    </p>
                    <p className="mt-2 text-[10px] font-mono text-primary/60 tracking-wider">
                      ORGANIZATION TOTAL {childRows.length > 0 ? `• ${childRows.length} LINKED ORGANIZATIONS` : ""}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Secondary Readouts */}
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-5">
                    <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-3">Average Daily Consumption</p>
                    <p className="font-mono text-2xl text-foreground flex items-baseline gap-1">
                      {formatValue(study.averageDailyConsumption)}<span className="text-sm text-muted-foreground/60">/d</span>
                    </p>
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">{study.rateBasis}</p>
                  </CardContent>
                </Card>
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-5">
                    <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-3">Estimated Days Remaining</p>
                    <p className="font-mono text-2xl text-foreground">
                      {study.daysRemaining < 0 ? <span className="text-muted-foreground/40">CALCULATING...</span> : `${study.daysRemaining} DAYS`}
                    </p>
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">
                      {study.daysRemaining < 0 ? "Insufficient Data" : "Derived from active rate"}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-5">
                    <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase flex items-center gap-2 mb-3">
                      <CalendarDays className="h-3.5 w-3.5 text-primary/50" /> Coverage Span
                    </p>
                    <p className="font-mono text-2xl text-foreground">{study.coverageDays} DAYS</p>
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">
                      {study.dailyHistory.length} Record{study.dailyHistory.length === 1 ? "" : "s"} // {study.rateWindowDays > 0 ? `W:${study.rateWindowDays}` : "W:ERR"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {study.dataQuality.length > 0 && (
                <div className="rounded border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3 items-start shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]">
                  <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-2">Data-quality notes</p>
                    <ul className="space-y-1.5 text-xs font-mono text-amber-500/80">
                      {study.dataQuality.map((note) => <li key={note}>&gt; {note}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] items-start">
                {/* Linked organizations */}
                <Card className="border-border/50 bg-card/40 flex flex-col h-full">
                  <div className="p-4 border-b border-border/50 bg-card/60 flex items-center gap-3">
                    <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center border border-primary/20">
                      <Network className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-bold tracking-widest text-foreground uppercase">Linked Organizations</p>
                      <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">Balance allocation within this organization</p>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto max-h-[400px]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card/95 backdrop-blur z-10 shadow-sm border-b border-border/50">
                        <TableRow className="hover:bg-transparent border-none">
                          <TableHead className="text-[10px] font-bold uppercase tracking-widest">Identity</TableHead>
                          <TableHead className="text-[10px] font-bold uppercase tracking-widest">Pool</TableHead>
                          <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Capacity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {childRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="h-32 text-center">
                              <p className="font-mono text-xs text-muted-foreground/50">No dependent nodes established.</p>
                            </TableCell>
                          </TableRow>
                        ) : childRows.map((child) => (
                          <TableRow key={child.organizationId} className="border-border/30 hover:bg-white/[0.02]">
                            <TableCell>
                              <p className="font-mono text-xs text-foreground/90 font-medium">{child.metric}</p>
                              <p className="font-mono text-[10px] text-muted-foreground/50 mt-0.5">
                                LVL:{child.organizationLevel} // ID:{child.financeId || 'NULL'}
                              </p>
                            </TableCell>
                            <TableCell className="font-mono text-[10px] text-muted-foreground/70">
                              {child.usesOrgBalance ? "SHARED" : "ISOLATED"}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs font-medium ${child.remainingBalance < 0 ? "text-rose-400" : ""}`}>
                              {formatExactValue(child.remainingBalance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>

                <div className="flex flex-col">
                  {/* Consumption chart */}
                  <Card className="border-border/50 bg-card/40">
                    <div className="p-4 border-b border-border/50 bg-card/60 flex items-center gap-3">
                      <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center border border-primary/20">
                        <TrendingUp className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs font-bold tracking-widest text-foreground uppercase">Daily Consumption</p>
                        <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">Verified daily balance usage</p>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      {chartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[280px] w-full">
                          <BarChart data={chartData} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="hsl(var(--border))" strokeOpacity={0.6} />
                            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} minTickGap={20} />
                            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={formatValue} />
                            <ChartTooltip
                              cursor={{ fill: 'hsl(var(--primary)/0.1)' }}
                              content={<ChartTooltipContent
                                formatter={(value) => <span className="font-mono font-bold text-primary">{formatValue(Number(value))} VOL</span>}
                                className="bg-popover border-border/80 text-xs shadow-xl"
                              />}
                            />
                            <Bar dataKey="consumption" fill="var(--color-consumption)" radius={[2, 2, 0, 0]} maxBarSize={30} className="hover:opacity-80 transition-opacity" />
                          </BarChart>
                        </ChartContainer>
                      ) : (
                        <div className="flex h-[280px] items-center justify-center text-xs font-mono text-muted-foreground/50 border border-dashed border-border/50 rounded">
                          NO TRACE DATA AVAILABLE
                        </div>
                      )}
                    </CardContent>
                  </Card>

                </div>
              </div>

              {/* Full-width balance history */}
              <Card className="overflow-hidden border-border/50 bg-card/40">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-card/60 px-5 py-4">
                  <div>
                    <p className="text-sm font-bold tracking-widest text-foreground uppercase">Balance History Ledger</p>
                    <p className="mt-1 text-xs text-muted-foreground">Daily balance snapshots and verified consumption intervals for this organization.</p>
                  </div>
                  <span className="rounded border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-primary">
                    {historyRows.length} ENTRIES
                  </span>
                </div>
                <div className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 border-b border-border/50 bg-card/95 backdrop-blur">
                      <TableRow className="border-none hover:bg-transparent">
                        <TableHead className="min-w-[130px] text-[10px] font-bold uppercase tracking-widest">Date</TableHead>
                        <TableHead className="min-w-[190px] text-right text-[10px] font-bold uppercase tracking-widest">Available balance</TableHead>
                        <TableHead className="min-w-[180px] text-right text-[10px] font-bold uppercase tracking-widest">Daily consumption</TableHead>
                        <TableHead className="min-w-[160px] text-right text-[10px] font-bold uppercase tracking-widest">Balance change</TableHead>
                        <TableHead className="min-w-[150px] text-right text-[10px] font-bold uppercase tracking-widest">History coverage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="h-32 text-center">
                            <span className="font-mono text-xs text-muted-foreground/50">NO BALANCE HISTORY AVAILABLE</span>
                          </TableCell>
                        </TableRow>
                      ) : historyRows.map((point) => (
                        <TableRow key={point.date} className="border-border/30 hover:bg-white/[0.02]">
                          <TableCell className="font-mono text-sm text-foreground">{formatDate(point.date)}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-foreground/90">{formatExactValue(point.balance)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-foreground/90">
                            {point.consumption > 0 ? formatExactValue(point.consumption) : <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm font-medium ${
                            point.balanceChange === null
                              ? "text-muted-foreground/50"
                              : point.balanceChange > 0
                                ? "text-emerald-400"
                                : point.balanceChange < 0
                                  ? "text-rose-400"
                                  : "text-muted-foreground"
                          }`}>
                            {point.balanceChange === null ? "—" : `${point.balanceChange > 0 ? "+" : ""}${formatExactValue(point.balanceChange)}`}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`inline-flex rounded border px-2 py-1 font-mono text-[11px] ${
                              point.isComplete
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                            }`}>
                              {point.isComplete ? "Complete" : "Partial"} · {point.organizationCount}/{point.expectedOrganizationCount}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
