import { useState, useMemo } from "react";
import {
  useGetGrafanaBalances,
  getGetGrafanaBalancesQueryKey,
  useGetAlertSummary,
  getGetAlertSummaryQueryKey,
  useTriggerAlerts,
  useGetSettings,
  useListGrafanaOrganizations,
  getListGrafanaOrganizationsQueryKey,
} from "@workspace/api-client-react";

type ClientBalance = {
  metric: string;
  financeId?: string | null;
  remainingBalance: number;
  dailyConsumption: number;
  recentDailyConsumption: number;
  daysRemaining: number;
  daysRemainingRecent: number;
  usingFallbackRate?: boolean;
  yesterdayConsumption: number;
  dailyChangePercent?: number | null;
  severity: string;
  lastUpdated?: string | null;
};
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, ShieldAlert, Activity, RefreshCw, Search, Filter, BarChart2, Info, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";
import OrganizationStudyDialog from "@/components/OrganizationStudyDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const REFRESH_OPTIONS = [
  { label: "Off", value: "0" },
  { label: "30s", value: "30000" },
  { label: "1 min", value: "60000" },
  { label: "5 min", value: "300000" },
  { label: "10 min", value: "600000" },
];

function SortableHead({
  col,
  label,
  sortCol,
  sortDir,
  onSort,
  align = "left",
  title,
}: {
  col: string;
  label: string;
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sortCol === col;
  return (
    <TableHead
      className={`font-mono text-xs font-semibold tracking-wider uppercase select-none cursor-pointer whitespace-nowrap ${align === "right" ? "text-right" : ""}`}
      title={title}
      onClick={() => onSort(col)}
    >
      <span className={`inline-flex items-center gap-1 transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"} ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active ? (
          sortDir === "asc" ? <ArrowUp className="w-3 h-3 shrink-0" /> : <ArrowDown className="w-3 h-3 shrink-0" />
        ) : (
          <ArrowUpDown className="w-3 h-3 shrink-0 opacity-40" />
        )}
      </span>
    </TableHead>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isTriggering, setIsTriggering] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState("0");
  const [orgFilter, setOrgFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedClient, setSelectedClient] = useState<{ metric: string; severity: string } | null>(null);
  const [sortCol, setSortCol] = useState<string>("daysRemaining");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const refetchMs = Number(refreshInterval) || false;

  const { data: balances, isLoading: isLoadingBalances, isFetching, dataUpdatedAt } = useGetGrafanaBalances({
    query: {
      queryKey: getGetGrafanaBalancesQueryKey(),
      refetchInterval: refetchMs,
    },
  });

  const { data: settings } = useGetSettings();
  const { data: organizationDirectory, isLoading: isLoadingOrganizationDirectory } = useListGrafanaOrganizations({
    query: {
      staleTime: 60_000,
      queryKey: getListGrafanaOrganizationsQueryKey(),
    },
  });
  const organizationList = Array.isArray(organizationDirectory) ? organizationDirectory : [];

  const { data: summary, isLoading: isLoadingSummary } = useGetAlertSummary({
    query: {
      queryKey: getGetAlertSummaryQueryKey(),
      refetchInterval: refetchMs,
    },
  });

  const triggerAlertsMutation = useTriggerAlerts();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetGrafanaBalancesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAlertSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGrafanaOrganizationsQueryKey() });
  };

  const handleTriggerAlerts = async () => {
    setIsTriggering(true);
    try {
      const result = await triggerAlertsMutation.mutateAsync();
      if (result.success) {
        toast({
          title: "Alerts Triggered Successfully",
          description: `Sent ${result.notificationsSent} notifications for ${result.clientsChecked} clients.`,
        });
        queryClient.invalidateQueries({ queryKey: getGetAlertSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetGrafanaBalancesQueryKey() });
      } else {
        toast({
          variant: "destructive",
          title: "Alert Trigger Failed",
          description: result.errors?.join(", ") || "An unknown error occurred.",
        });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to trigger alerts.";
      toast({ variant: "destructive", title: "Error Triggering Alerts", description: msg });
    } finally {
      setIsTriggering(false);
    }
  };

  const formatBalance = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (abs >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "ok": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "warning": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "critical": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "emergency": return "bg-red-900/40 text-red-400 border-red-500/40 animate-pulse";
      case "immediate": return "bg-purple-900/60 text-purple-200 border-purple-400/60 animate-pulse";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "ok": return <CheckCircle2 className="w-4 h-4 mr-1 inline" />;
      case "warning": return <AlertCircle className="w-4 h-4 mr-1 inline" />;
      case "critical": return <ShieldAlert className="w-4 h-4 mr-1 inline" />;
      case "emergency": return <Activity className="w-4 h-4 mr-1 inline" />;
      case "immediate": return <ShieldAlert className="w-4 h-4 mr-1 inline" />;
      default: return null;
    }
  };

  // Live severity counts from the actual balance data (not historical)
  const liveCounts = useMemo(() => {
    if (!balances) return { warning: 0, critical: 0, emergency: 0, immediate: 0 };
    return balances.reduce(
      (acc: { warning: number; critical: number; emergency: number; immediate: number }, b: ClientBalance) => {
        const s = b.severity.toLowerCase();
        if (s === "warning") acc.warning++;
        else if (s === "critical") acc.critical++;
        else if (s === "emergency") acc.emergency++;
        else if (s === "immediate") acc.immediate++;
        return acc;
      },
      { warning: 0, critical: 0, emergency: 0, immediate: 0 }
    );
  }, [balances]);

  const SEVERITY_ORDER: Record<string, number> = { ok: 0, warning: 1, critical: 2, emergency: 3, immediate: 4 };

  // Filtered + sorted rows
  const filteredBalances = useMemo(() => {
    if (!balances) return [];
    const filtered = balances.filter((b: ClientBalance) => {
      const matchOrg = orgFilter === "" ||
        b.metric.toLowerCase().includes(orgFilter.toLowerCase()) ||
        (b.financeId != null && String(b.financeId).includes(orgFilter));
      const matchStatus = statusFilter === "all" || b.severity.toLowerCase() === statusFilter.toLowerCase();
      return matchOrg && matchStatus;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a: ClientBalance, b: ClientBalance) => {
      switch (sortCol) {
        case "metric":
          return dir * a.metric.localeCompare(b.metric);
        case "remainingBalance":
          return dir * (a.remainingBalance - b.remainingBalance);
        case "dailyConsumption": {
          const aVal = a.dailyConsumption > 0 ? a.dailyConsumption : (a.recentDailyConsumption ?? 0);
          const bVal = b.dailyConsumption > 0 ? b.dailyConsumption : (b.recentDailyConsumption ?? 0);
          return dir * (aVal - bVal);
        }
        case "dailyChangePercent":
          return dir * ((a.dailyChangePercent ?? 0) - (b.dailyChangePercent ?? 0));
        case "daysRemaining": {
          const aD = a.daysRemaining ?? Infinity;
          const bD = b.daysRemaining ?? Infinity;
          return dir * (aD - bD);
        }
        case "severity":
          return dir * ((SEVERITY_ORDER[a.severity.toLowerCase()] ?? 0) - (SEVERITY_ORDER[b.severity.toLowerCase()] ?? 0));
        case "lastUpdated":
          return dir * (new Date(a.lastUpdated ?? 0).getTime() - new Date(b.lastUpdated ?? 0).getTime());
        default:
          return 0;
      }
    });
    return filtered;
  }, [balances, orgFilter, statusFilter, sortCol, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Status</h1>
          <p className="text-muted-foreground mt-1">Live monitoring of client SMS credit balances.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
            <Select
              value={selectedClient?.metric ?? ""}
              onValueChange={(metric) => {
                const existing = balances?.find((balance) => balance.metric === metric);
                setSelectedClient({ metric, severity: existing?.severity ?? "ok" });
              }}
            >
              <SelectTrigger className="h-9 w-52 bg-background/50 text-sm">
                <SelectValue placeholder="Organization study" />
              </SelectTrigger>
              <SelectContent>
                {isLoadingOrganizationDirectory ? (
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

          {/* Auto-refresh selector */}
          <div className="flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
            <Select value={refreshInterval} onValueChange={setRefreshInterval}>
              <SelectTrigger className="w-28 h-9 text-sm bg-background/50">
                <SelectValue placeholder="Refresh" />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="h-9"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>

          <Button
            onClick={handleTriggerAlerts}
            disabled={isTriggering}
            variant="destructive"
            className="font-bold tracking-wider"
          >
            {isTriggering ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Activity className="mr-2 h-4 w-4" />
            )}
            {isTriggering ? "PROCESSING..." : "TRIGGER ALERTS NOW"}
          </Button>
        </div>
      </div>

      {/* Last refreshed */}
      {dataUpdatedAt > 0 && (
        <p className="text-xs text-muted-foreground -mt-4">
          Last updated: {format(new Date(dataUpdatedAt), "PP HH:mm:ss")}
          {refreshInterval !== "0" && (
            <span className="ml-2 text-primary">
              · Auto-refreshing every {REFRESH_OPTIONS.find((o) => o.value === refreshInterval)?.label}
            </span>
          )}
        </p>
      )}

      {/* Summary cards — live counts from balance data; clicking a severity card filters the table */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          className={`bg-card/50 backdrop-blur cursor-pointer transition-all hover:bg-card/70 ${statusFilter === "all" ? "ring-1 ring-primary/60" : ""}`}
          onClick={() => setStatusFilter("all")}
          title="Show all clients"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Alerts Sent</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-7 w-20" /> : (
              <div className="text-2xl font-bold text-primary">{summary?.totalAlertsSent || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Last run: {summary?.lastRunAt ? format(new Date(summary.lastRunAt), "PP p") : "Never"}
            </p>
          </CardContent>
        </Card>

        <Card
          className={`bg-card/50 backdrop-blur cursor-pointer transition-all hover:bg-card/70 border-yellow-500/20 hover:border-yellow-500/60 ${statusFilter === "warning" ? "ring-1 ring-yellow-500" : ""}`}
          onClick={() => setStatusFilter(statusFilter === "warning" ? "all" : "warning")}
          title="Filter: Warning clients"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-yellow-500">Clients in Warning</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {isLoadingBalances ? <Skeleton className="h-7 w-20" /> : (
              <div className="text-2xl font-bold text-yellow-500">{liveCounts.warning}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">&lt; {settings?.thresholdStaff ?? 20} days remaining</p>
          </CardContent>
        </Card>

        <Card
          className={`bg-card/50 backdrop-blur cursor-pointer transition-all hover:bg-card/70 border-red-500/20 hover:border-red-500/60 ${statusFilter === "critical" ? "ring-1 ring-red-500" : ""}`}
          onClick={() => setStatusFilter(statusFilter === "critical" ? "all" : "critical")}
          title="Filter: Critical clients"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-red-500">Clients in Critical</CardTitle>
            <ShieldAlert className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {isLoadingBalances ? <Skeleton className="h-7 w-20" /> : (
              <div className="text-2xl font-bold text-red-500">{liveCounts.critical}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">&lt; {settings?.thresholdManager ?? 15} days remaining</p>
          </CardContent>
        </Card>

        <Card
          className={`bg-card/50 backdrop-blur cursor-pointer transition-all hover:bg-card/70 border-red-900/40 hover:border-red-400/60 ${statusFilter === "emergency" ? "ring-1 ring-red-400" : ""}`}
          onClick={() => setStatusFilter(statusFilter === "emergency" ? "all" : "emergency")}
          title="Filter: Emergency clients"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-red-400">Emergency Status</CardTitle>
            <Activity className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            {isLoadingBalances ? <Skeleton className="h-7 w-20" /> : (
              <div className="text-2xl font-bold text-red-400">{liveCounts.emergency}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">&lt; {settings?.thresholdMd ?? 5} days remaining</p>
          </CardContent>
        </Card>
      </div>

      {/* Immediate Intervention banner — shown only when there are affected clients */}
      {(liveCounts.immediate > 0) && (
        <Card
          className={`bg-purple-900/30 backdrop-blur cursor-pointer transition-all hover:bg-purple-900/40 border-purple-400/50 hover:border-purple-400/80 animate-pulse ${statusFilter === "immediate" ? "ring-2 ring-purple-400" : ""}`}
          onClick={() => setStatusFilter(statusFilter === "immediate" ? "all" : "immediate")}
          title="Filter: Immediate Intervention clients"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-purple-200">Immediate Intervention Required</CardTitle>
            <ShieldAlert className="h-4 w-4 text-purple-300" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-200">{liveCounts.immediate}</div>
            <p className="text-xs text-purple-300/70 mt-1">&lt; {settings?.thresholdImmediate ?? 1} days remaining — act now</p>
          </CardContent>
        </Card>
      )}

      {/* Client balances table */}
      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <CardTitle>Client Balances</CardTitle>
            <div className="flex flex-wrap gap-2">
              {/* Org search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search org or ID..."
                  value={orgFilter}
                  onChange={(e) => setOrgFilter(e.target.value)}
                  className="pl-8 h-9 w-48 bg-background/50 text-sm"
                />
              </div>
              {/* Status filter */}
              <div className="flex items-center gap-1.5">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-36 bg-background/50 text-sm">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="ok">OK</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="emergency">Emergency</SelectItem>
                    <SelectItem value="immediate">Immediate Intervention</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          {(orgFilter || statusFilter !== "all") && (
            <p className="text-xs text-muted-foreground mt-1">
              Showing {filteredBalances.length} of {balances?.length ?? 0} clients
              {orgFilter && <span> · org: "{orgFilter}"</span>}
              {statusFilter !== "all" && <span> · status: {statusFilter}</span>}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <SortableHead col="metric" label="Metric/Client" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="left" />
                <TableHead className="text-muted-foreground text-xs font-medium w-20">ID</TableHead>
                <SortableHead col="remainingBalance" label="Balance" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortableHead col="dailyConsumption" label="Avg/Day (prev. mo.)" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" title="Average daily consumption based on the previous 30 days" />
                <SortableHead col="dailyChangePercent" label="Daily Δ" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" title="Yesterday's consumption vs the day before: red = increased (burning faster), green = decreased" />
                <SortableHead col="daysRemaining" label="Est. Days" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" title="Estimated days remaining based on average daily consumption rate" />
                <SortableHead col="severity" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="left" />
                <SortableHead col="lastUpdated" label="Last Updated" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingBalances ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredBalances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    {balances?.length === 0
                      ? "No client balance data available. Check Grafana connection in Settings."
                      : "No clients match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredBalances.map((balance: ClientBalance) => (
                  <TableRow
                    key={balance.metric}
                    className="border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group"
                    onClick={() => setSelectedClient({ metric: balance.metric, severity: balance.severity })}
                    title="Click to view consumption history"
                  >
                    <TableCell className="font-mono text-sm font-medium">
                      <span className="flex items-center gap-1.5">
                        {balance.metric}
                        <BarChart2 className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono w-20">
                      {balance.financeId ?? <span className="opacity-40">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={balance.remainingBalance < 0 ? "text-red-400" : ""}>
                        {formatBalance(balance.remainingBalance)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {balance.dailyConsumption > 0 ? (
                        formatBalance(balance.dailyConsumption) + "/d"
                      ) : balance.recentDailyConsumption > 0 ? (
                        <span title="Based on last 7-day rate (prev. month data unavailable)">
                          ~{formatBalance(balance.recentDailyConsumption)}/d
                          <span className="text-muted-foreground text-[10px] ml-0.5">(7d)</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {balance.dailyChangePercent === null || balance.dailyChangePercent === undefined ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center gap-0.5 text-xs font-bold font-mono px-1.5 py-0.5 rounded ${
                                balance.dailyChangePercent > 5
                                  ? "bg-green-500/15 text-green-400"
                                  : balance.dailyChangePercent < -5
                                  ? "bg-red-500/15 text-red-400"
                                  : "bg-muted/40 text-muted-foreground"
                              }`}>
                                {balance.dailyChangePercent > 0 ? "↑" : balance.dailyChangePercent < 0 ? "↓" : "→"}
                                {" "}{Math.abs(balance.dailyChangePercent).toFixed(1)}%
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="p-0 bg-popover text-popover-foreground border border-border/60 shadow-lg">
                              <div className="p-3 space-y-2">
                                <p className="text-xs font-semibold text-foreground border-b border-border/40 pb-1.5">Daily Consumption Study</p>
                                <div className="flex justify-between gap-6 text-xs">
                                  <span className="text-muted-foreground">Yesterday</span>
                                  <span className="font-mono font-semibold">{formatBalance(balance.yesterdayConsumption)}</span>
                                </div>
                                <div className="flex justify-between gap-6 text-xs">
                                  <span className="text-muted-foreground">Day before</span>
                                  <span className="font-mono font-semibold">
                                    {balance.dailyChangePercent !== null
                                      ? formatBalance(balance.yesterdayConsumption / (1 + balance.dailyChangePercent / 100))
                                      : "—"}
                                  </span>
                                </div>
                                <div className={`flex justify-between gap-6 text-xs border-t border-border/40 pt-1.5 font-semibold ${
                                  balance.dailyChangePercent > 5 ? "text-green-400"
                                  : balance.dailyChangePercent < -5 ? "text-red-400"
                                  : "text-muted-foreground"
                                }`}>
                                  <span>Change</span>
                                  <span className="font-mono">
                                    {balance.dailyChangePercent > 0 ? "+" : ""}
                                    {balance.dailyChangePercent.toFixed(1)}%
                                    {balance.dailyChangePercent > 5 ? " ↑ Higher" : balance.dailyChangePercent < -5 ? " ↓ Lower" : " ≈ Stable"}
                                  </span>
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold text-lg">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 cursor-help">
                              {balance.daysRemaining < 0 ? (
                                <span className="text-muted-foreground font-normal text-sm">N/A</span>
                              ) : (
                                <span className="inline-flex items-baseline gap-1">
                                  {balance.daysRemaining}
                                  {balance.usingFallbackRate && (
                                    <span className="text-[10px] font-normal text-amber-400 leading-none">~</span>
                                  )}
                                </span>
                              )}
                              <Info className="w-3 h-3 text-muted-foreground opacity-60" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="max-w-[240px] p-0 bg-popover text-popover-foreground border border-border/60 shadow-lg"
                          >
                            <div className="p-3 space-y-2.5">
                              <p className="text-xs font-semibold text-foreground border-b border-border/40 pb-1.5">
                                Est. Days Breakdown
                              </p>
                              {balance.usingFallbackRate && (
                                <p className="text-[10px] text-amber-400 leading-snug">
                                  ⚠ Estimated from 7-day rate — prev. month data unavailable
                                </p>
                              )}
                              <div className="flex justify-between gap-4 text-xs">
                                <span className="text-muted-foreground">Prev. month rate</span>
                                <span className="font-mono font-semibold">
                                  {balance.dailyConsumption > 0 ? `${balance.daysRemaining < 0 ? "N/A" : balance.daysRemaining + "d"}` : "—"}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 text-xs">
                                <span className="text-muted-foreground">Last 7-day rate</span>
                                <span className={`font-mono font-semibold ${
                                  balance.daysRemainingRecent < 0
                                    ? "text-muted-foreground"
                                    : balance.daysRemainingRecent < (balance.daysRemaining < 0 ? Infinity : balance.daysRemaining)
                                    ? "text-red-400"
                                    : "text-green-400"
                                }`}>
                                  {balance.daysRemainingRecent < 0 ? "N/A" : `${balance.daysRemainingRecent}d`}
                                </span>
                              </div>
                              <div className="border-t border-border/40 pt-1.5 space-y-1">
                                <div className="flex justify-between gap-4 text-[10px] text-muted-foreground">
                                  <span>Avg/day (prev. mo.)</span>
                                  <span className="font-mono">{balance.dailyConsumption > 0 ? formatBalance(balance.dailyConsumption) + "/d" : "—"}</span>
                                </div>
                                <div className="flex justify-between gap-4 text-[10px] text-muted-foreground">
                                  <span>Avg/day (last 7d)</span>
                                  <span className="font-mono">{balance.recentDailyConsumption > 0 ? formatBalance(balance.recentDailyConsumption) + "/d" : "—"}</span>
                                </div>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`uppercase tracking-wider font-bold ${getSeverityColor(balance.severity)}`}>
                        {getSeverityIcon(balance.severity)}
                        {balance.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {balance.lastUpdated ? format(new Date(balance.lastUpdated), "MMM d, HH:mm") : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OrganizationStudyDialog
        metric={selectedClient?.metric ?? null}
        fallbackSeverity={selectedClient?.severity ?? "ok"}
        onClose={() => setSelectedClient(null)}
        onSelectMetric={(metric) => {
          const existing = balances?.find((balance) => balance.metric === metric);
          setSelectedClient({ metric, severity: existing?.severity ?? "ok" });
        }}
      />
    </div>
  );
}
