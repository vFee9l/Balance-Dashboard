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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { AlertCircle, CalendarDays, Gauge, Landmark, Network, TrendingDown, TrendingUp } from "lucide-react";
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
    color: "hsl(var(--chart-1))",
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

function severityClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "ok":
      return "border-green-500/30 bg-green-500/10 text-green-400";
    case "warning":
      return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
    case "critical":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    case "emergency":
      return "border-red-400/50 bg-red-900/40 text-red-300";
    case "immediate":
      return "border-purple-400/50 bg-purple-900/50 text-purple-200";
    default:
      return "border-border bg-muted text-muted-foreground";
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
  const chartData = study?.dailyHistory.map((point) => ({
    ...point,
    label: formatDate(point.date),
  })) ?? [];
  const historyRows = [...(study?.dailyHistory ?? [])].reverse();
  const childRows = study?.children ?? [];

  return (
    <Dialog open={!!metric} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-border/60 bg-card">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-3 pr-8">
            <div className="min-w-52 flex-1">
              <Select value={metric ?? ""} onValueChange={onSelectMetric}>
                <SelectTrigger className="bg-background/70 font-mono">
                  <SelectValue placeholder="Choose an organization" />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingOrganizations ? (
                    <SelectItem value="loading" disabled>Loading organizations…</SelectItem>
                  ) : (
                    organizationList.map((organization) => (
                      <SelectItem key={organization.metric} value={organization.metric}>
                        {organization.metric}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="outline" className={`uppercase tracking-wider ${severityClass(displayedSeverity)}`}>
              {displayedSeverity}
            </Badge>
          </div>
          <DialogTitle className="pt-2 font-mono text-xl">{metric ?? "Organization study"}</DialogTitle>
          <DialogDescription>
            Grafana-aligned live balance and a consumption forecast based on the most recent available daily history.
          </DialogDescription>
        </DialogHeader>

        {isLoadingStudy && (
          <div className="space-y-4 py-4">
            <div className="grid gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {isError && (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="font-medium">The organization study could not be loaded.</p>
            <p className="text-sm text-muted-foreground">Check the Grafana connection and try again.</p>
          </div>
        )}

        {study && !isLoadingStudy && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Landmark className="h-3.5 w-3.5" /> Finance ID
                  </div>
                  <p className="mt-2 font-mono text-2xl font-semibold">
                    {study.financeId && Number(study.financeId) > 0 ? study.financeId : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Gauge className="h-3.5 w-3.5" /> Uses organization balance
                  </div>
                  <p className={`mt-2 font-mono text-2xl font-semibold ${study.usesOrgBalance ? "text-green-400" : "text-muted-foreground"}`}>
                    {study.usesOrgBalance ? "TRUE" : "FALSE"}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-primary/30 bg-primary/5 sm:col-span-2">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <TrendingDown className="h-3.5 w-3.5" /> Grafana live remaining balance
                  </div>
                  <p className={`mt-2 font-mono text-3xl font-semibold ${study.remainingBalance < 0 ? "text-destructive" : "text-primary"}`}>
                    {formatExactValue(study.remainingBalance)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rolled-up parent total{childRows.length > 0 ? ` · includes ${childRows.length} child balance${childRows.length === 1 ? "" : "s"}` : ""}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Card className="border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Average daily consumption</p>
                  <p className="mt-2 font-mono text-xl font-semibold">{formatValue(study.averageDailyConsumption)}/d</p>
                  <p className="mt-1 text-xs text-muted-foreground">{study.rateBasis}</p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Estimated days remaining</p>
                  <p className="mt-2 font-mono text-xl font-semibold">
                    {study.daysRemaining < 0 ? "Not available" : `${study.daysRemaining} days`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {study.daysRemaining < 0 ? "A complete daily rate is required" : "Using the displayed study rate"}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" /> History coverage
                  </div>
                  <p className="mt-2 font-mono text-xl font-semibold">{study.coverageDays} days</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {study.rateWindowDays > 0 ? `${study.rateWindowDays}-day rate window` : "No usable rate window"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {study.dataQuality.length > 0 && (
              <div className="space-y-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-yellow-400">Data notes</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {study.dataQuality.map((note) => <li key={note}>• {note}</li>)}
                </ul>
              </div>
            )}

            <Card className="border-primary/25 bg-primary/[0.03]">
              <CardContent className="p-0">
                <div className="border-b border-border/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Network className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">Child organization balances</p>
                      <p className="text-xs text-muted-foreground">
                        Live child balances from the same Grafana refresh as the rolled-up parent total above.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="max-h-72 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Child organization</TableHead>
                        <TableHead>Finance ID</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Balance source</TableHead>
                        <TableHead className="text-right">Remaining balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {childRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                            No child organizations are reported for this parent. The balance above is the parent organization’s own Grafana balance.
                          </TableCell>
                        </TableRow>
                      ) : childRows.map((child) => (
                        <TableRow key={child.organizationId}>
                          <TableCell className="font-medium">{child.metric}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {child.financeId && Number(child.financeId) > 0 ? child.financeId : "—"}
                          </TableCell>
                          <TableCell className="capitalize text-xs text-muted-foreground">{child.organizationLevel}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {child.usesOrgBalance ? "Organization balance" : "User balance"}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-xs ${child.remainingBalance < 0 ? "text-destructive" : ""}`}>
                            {formatExactValue(child.remainingBalance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-muted/10">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Daily consumption study</p>
                    <p className="text-xs text-muted-foreground">Positive daily balance drops across up to 90 days of Grafana history.</p>
                  </div>
                </div>
                {chartData.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-64 w-full">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} minTickGap={26} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={formatValue} width={58} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value) => [formatValue(Number(value)), "Consumed"]} />} />
                      <Bar dataKey="consumption" fill="var(--color-consumption)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    No daily balance history is available for this organization.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-muted/10">
              <CardContent className="p-0">
                <div className="border-b border-border/60 px-4 py-3">
                  <p className="text-sm font-semibold">Daily balance summary</p>
                  <p className="text-xs text-muted-foreground">Most recent days first</p>
                </div>
                <div className="max-h-64 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="text-right">Consumed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                            No daily balance history is available.
                          </TableCell>
                        </TableRow>
                      ) : historyRows.map((point) => (
                        <TableRow key={point.date}>
                          <TableCell className="font-mono text-xs">{formatDate(point.date)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatExactValue(point.balance)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatExactValue(point.consumption)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}