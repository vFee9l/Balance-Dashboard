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
  historyCoverageDays: number;
  dailyBalanceChange: number | null;
  severity: string;
  lastUpdated?: string | null;
};
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, ShieldAlert, Activity, RefreshCw, Search, Filter, BarChart2, Info, ArrowUp, ArrowDown, ArrowUpDown, TriangleAlert, Zap } from "lucide-react";
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
      className={`font-mono text-[11px] font-semibold tracking-wider uppercase select-none cursor-pointer whitespace-nowrap bg-card/40 ${align === "right" ? "text-right" : ""}`}
      title={title}
      onClick={() => onSort(col)}
      data-testid={`sort-header-${col}`}
    >
      <span className={`inline-flex items-center gap-1 transition-colors ${active ? "text-primary" : "text-muted-foreground hover:text-foreground/70"} ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active ? (
          sortDir === "asc" ? <ArrowUp className="w-3 h-3 shrink-0" /> : <ArrowDown className="w-3 h-3 shrink-0" />
        ) : (
          <ArrowUpDown className="w-3 h-3 shrink-0 opacity-30" />
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
  const [sortCol, setSortCol] = useState<string>("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "severity" ? "desc" : "asc");
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

  const openOrganizationStudyFromSelector = (metric: string) => {
    const existing = balances?.find((balance) => balance.metric === metric);
    // Let Radix finish closing and restoring focus to the selector before the
    // dialog's focus trap opens. Opening both in the same event caused a
    // null-focus race in the browser.
    window.setTimeout(() => {
      setSelectedClient({ metric, severity: existing?.severity ?? "ok" });
    }, 0);
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

  const getSeverityStyles = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "ok":
        return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", glow: "shadow-[0_0_10px_rgba(52,211,153,0.1)]" };
      case "warning":
        return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", glow: "shadow-[0_0_10px_rgba(251,191,36,0.15)]" };
      case "critical":
        return { text: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/30", glow: "shadow-[0_0_10px_rgba(244,63,94,0.2)]" };
      case "emergency":
        return { text: "text-pink-500", bg: "bg-pink-600/20", border: "border-pink-500/40", glow: "shadow-[0_0_15px_rgba(236,72,153,0.3)] animate-pulse" };
      case "immediate":
        return { text: "text-purple-400", bg: "bg-purple-600/20", border: "border-purple-500/40", glow: "shadow-[0_0_15px_rgba(168,85,247,0.3)] animate-pulse" };
      default:
        return { text: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", glow: "" };
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "ok": return <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 inline" />;
      case "warning": return <TriangleAlert className="w-3.5 h-3.5 mr-1.5 inline" />;
      case "critical": return <ShieldAlert className="w-3.5 h-3.5 mr-1.5 inline" />;
      case "emergency": return <Activity className="w-3.5 h-3.5 mr-1.5 inline" />;
      case "immediate": return <Zap className="w-3.5 h-3.5 mr-1.5 inline" />;
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
        case "historyCoverageDays":
          return dir * (a.historyCoverageDays - b.historyCoverageDays);
        case "dailyBalanceChange":
          return dir * ((a.dailyBalanceChange ?? 0) - (b.dailyBalanceChange ?? 0));
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
      {/* Header Area */}
      <div className="flex flex-col xl:flex-row gap-6 justify-between items-start xl:items-center bg-card/40 border border-border/50 rounded-lg p-5 backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
            TELEMETRY DASHBOARD
            {isFetching && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-primary bg-primary/10 px-2 py-1 rounded border border-primary/20">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                SYNCING
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium tracking-wide">
            Live client SMS credit monitoring and burn-rate forecast.
          </p>
          {dataUpdatedAt > 0 && (
            <p className="text-xs font-mono text-muted-foreground/60 mt-2 flex items-center gap-1.5">
              <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/40" />
              LAST SEEN: {format(new Date(dataUpdatedAt), "HH:mm:ss.SSS")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Select
            value={selectedClient?.metric ?? ""}
            onValueChange={openOrganizationStudyFromSelector}
          >
            <SelectTrigger className="h-10 w-[220px] bg-background/50 border-border/60 hover:border-primary/40 transition-colors font-mono text-xs">
              <Search className="w-3.5 h-3.5 mr-2 opacity-50" />
              <SelectValue placeholder="Lookup Org Study..." />
            </SelectTrigger>
            <SelectContent>
              {isLoadingOrganizationDirectory ? (
                <SelectItem value="loading" disabled>Loading index…</SelectItem>
              ) : (
                organizationList.map((organization) => (
                  <SelectItem key={organization.metric} value={organization.metric} className="font-mono text-xs">
                    {organization.metric}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1 bg-background/50 border border-border/60 rounded-md p-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="h-9 w-9 p-0 hover:bg-primary/10 hover:text-primary rounded"
              title="Force sync"
              data-testid="button-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin text-primary" : "text-muted-foreground"}`} />
            </Button>
            <div className="w-px h-5 bg-border/60 mx-1" />
            <Select value={refreshInterval} onValueChange={setRefreshInterval}>
              <SelectTrigger className="h-9 w-[110px] border-0 bg-transparent focus:ring-0 font-mono text-xs text-muted-foreground hover:text-foreground">
                <SelectValue placeholder="Auto-refresh" />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="font-mono text-xs">
                    SYNC: {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleTriggerAlerts}
            disabled={isTriggering}
            data-testid="button-trigger-alerts"
            className={`h-10 px-5 font-bold tracking-widest text-[11px] border shadow-lg transition-all duration-300 ${
              isTriggering
                ? "bg-primary/20 text-primary border-primary/40 cursor-wait"
                : "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/50 hover:shadow-[0_0_15px_rgba(244,63,94,0.3)] hover:-translate-y-0.5"
            }`}
          >
            {isTriggering ? (
              <>
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                EXECUTING...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-3.5 w-3.5" />
                TRIGGER ALERTS
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Readout Panels */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          className={`relative overflow-hidden cursor-pointer transition-all duration-200 border-l-4 group bg-card/40 backdrop-blur-sm ${
            statusFilter === "all"
              ? "border-l-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary),0.08)] ring-1 ring-primary/20"
              : "border-l-border hover:bg-card/80 hover:border-l-primary/50"
          }`}
          onClick={() => setStatusFilter("all")}
          data-testid="card-filter-all"
        >
          <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-40 transition-opacity">
            <Activity className="h-16 w-16 -mr-4 -mt-4 text-primary" />
          </div>
          <CardContent className="p-5">
            <p className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase mb-1 flex items-center gap-1.5">
              Network Status
            </p>
            {isLoadingSummary ? <Skeleton className="h-8 w-24 mb-1" /> : (
              <div className="text-3xl font-mono font-bold text-foreground tracking-tight flex items-baseline gap-2">
                {summary?.totalAlertsSent || 0}
                <span className="text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider">Alerts Sent</span>
              </div>
            )}
            <p className="text-xs font-mono text-muted-foreground mt-3 pt-3 border-t border-border/50">
              Run: <span className="text-foreground/80">{summary?.lastRunAt ? format(new Date(summary.lastRunAt), "HH:mm:ss") : "Never"}</span>
            </p>
          </CardContent>
        </Card>

        <Card
          className={`relative overflow-hidden cursor-pointer transition-all duration-200 border-l-4 group bg-card/40 backdrop-blur-sm ${
            statusFilter === "warning"
              ? "border-l-amber-500 bg-amber-500/5 shadow-[0_0_20px_rgba(245,158,11,0.08)] ring-1 ring-amber-500/20"
              : "border-l-amber-500/20 hover:bg-card/80 hover:border-l-amber-500/50"
          }`}
          onClick={() => setStatusFilter(statusFilter === "warning" ? "all" : "warning")}
          data-testid="card-filter-warning"
        >
          <div className="absolute top-0 right-0 p-3 opacity-[0.15] group-hover:opacity-30 transition-opacity">
            <TriangleAlert className="h-16 w-16 -mr-4 -mt-4 text-amber-500" />
          </div>
          <CardContent className="p-5">
            <p className="text-[11px] font-bold tracking-widest text-amber-500/80 uppercase mb-1 flex items-center gap-1.5">
              Warning Node
            </p>
            {isLoadingBalances ? <Skeleton className="h-8 w-16 mb-1" /> : (
              <div className="text-3xl font-mono font-bold text-amber-400 tracking-tight flex items-baseline gap-2">
                {liveCounts.warning}
                <span className="text-[11px] font-sans font-medium text-amber-500/60 uppercase tracking-wider">Clients</span>
              </div>
            )}
            <p className="text-xs font-mono text-muted-foreground mt-3 pt-3 border-t border-border/50 flex items-center gap-1">
              &lt; {settings?.thresholdStaff ?? 20} <span className="text-muted-foreground/60">DAYS REMAINING</span>
            </p>
          </CardContent>
        </Card>

        <Card
          className={`relative overflow-hidden cursor-pointer transition-all duration-200 border-l-4 group bg-card/40 backdrop-blur-sm ${
            statusFilter === "critical"
              ? "border-l-rose-500 bg-rose-500/5 shadow-[0_0_20px_rgba(244,63,94,0.08)] ring-1 ring-rose-500/20"
              : "border-l-rose-500/20 hover:bg-card/80 hover:border-l-rose-500/50"
          }`}
          onClick={() => setStatusFilter(statusFilter === "critical" ? "all" : "critical")}
          data-testid="card-filter-critical"
        >
          <div className="absolute top-0 right-0 p-3 opacity-[0.12] group-hover:opacity-25 transition-opacity">
            <ShieldAlert className="h-16 w-16 -mr-4 -mt-4 text-rose-500" />
          </div>
          <CardContent className="p-5">
            <p className="text-[11px] font-bold tracking-widest text-rose-500/80 uppercase mb-1 flex items-center gap-1.5">
              Critical Node
            </p>
            {isLoadingBalances ? <Skeleton className="h-8 w-16 mb-1" /> : (
              <div className="text-3xl font-mono font-bold text-rose-500 tracking-tight flex items-baseline gap-2">
                {liveCounts.critical}
                <span className="text-[11px] font-sans font-medium text-rose-500/60 uppercase tracking-wider">Clients</span>
              </div>
            )}
            <p className="text-xs font-mono text-muted-foreground mt-3 pt-3 border-t border-border/50 flex items-center gap-1">
              &lt; {settings?.thresholdManager ?? 15} <span className="text-muted-foreground/60">DAYS REMAINING</span>
            </p>
          </CardContent>
        </Card>

        <Card
          className={`relative overflow-hidden cursor-pointer transition-all duration-200 border-l-4 group bg-card/40 backdrop-blur-sm ${
            statusFilter === "emergency"
              ? "border-l-pink-500 bg-pink-500/10 shadow-[0_0_20px_rgba(236,72,153,0.15)] ring-1 ring-pink-500/30"
              : "border-l-pink-500/30 hover:bg-card/80 hover:border-l-pink-500/60"
          }`}
          onClick={() => setStatusFilter(statusFilter === "emergency" ? "all" : "emergency")}
          data-testid="card-filter-emergency"
        >
          <div className="absolute top-0 right-0 p-3 opacity-[0.15] group-hover:opacity-30 transition-opacity">
            <Activity className="h-16 w-16 -mr-4 -mt-4 text-pink-500" />
          </div>
          <CardContent className="p-5">
            <p className="text-[11px] font-bold tracking-widest text-pink-400 uppercase mb-1 flex items-center gap-1.5">
              Emergency Node
            </p>
            {isLoadingBalances ? <Skeleton className="h-8 w-16 mb-1" /> : (
              <div className="text-3xl font-mono font-bold text-pink-500 tracking-tight flex items-baseline gap-2">
                {liveCounts.emergency}
                <span className="text-[11px] font-sans font-medium text-pink-500/60 uppercase tracking-wider">Clients</span>
              </div>
            )}
            <p className="text-xs font-mono text-pink-400/70 mt-3 pt-3 border-t border-pink-500/20 flex items-center gap-1">
              &lt; {settings?.thresholdMd ?? 5} <span className="text-pink-400/50">DAYS REMAINING</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Immediate Intervention banner */}
      {(liveCounts.immediate > 0) && (
        <Card
          className={`bg-purple-900/20 backdrop-blur-md cursor-pointer transition-all border-l-4 group overflow-hidden relative ${
            statusFilter === "immediate"
              ? "border-l-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.2)] ring-1 ring-purple-500/40"
              : "border-l-purple-500 hover:bg-purple-900/30 border-y-purple-500/30 border-r-purple-500/30 animate-pulse"
          }`}
          onClick={() => setStatusFilter(statusFilter === "immediate" ? "all" : "immediate")}
          data-testid="banner-immediate"
        >
          <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(168,85,247,0.03)_10px,rgba(168,85,247,0.03)_20px)] pointer-events-none" />
          <CardContent className="p-5 flex items-center justify-between relative z-10">
            <div className="flex items-center gap-6">
              <div className="h-12 w-12 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                <Zap className="h-6 w-6 text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight text-purple-300 flex items-center gap-2">
                  IMMEDIATE INTERVENTION REQUIRED
                  <span className="bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full font-mono font-bold shadow-[0_0_10px_rgba(168,85,247,0.6)]">
                    {liveCounts.immediate} CLIENTS
                  </span>
                </h3>
                <p className="text-sm text-purple-400/80 mt-1 font-mono">
                  &lt; {settings?.thresholdImmediate ?? 1} DAYS REMAINING — ACTION MANDATORY
                </p>
              </div>
            </div>
            <Button variant="ghost" className="text-purple-300 hover:text-purple-100 hover:bg-purple-500/20 font-bold tracking-widest text-xs uppercase">
              {statusFilter === "immediate" ? "View All" : "Filter View"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Grid Data */}
      <Card className="bg-card/40 backdrop-blur-md border-border/60 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border/60 flex flex-wrap gap-4 items-center justify-between bg-card/60">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
            <h2 className="text-sm font-bold tracking-widest text-foreground uppercase">Data Grid</h2>
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded ml-2">
              {filteredBalances.length} / {balances?.length ?? 0}
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
              <Input
                placeholder="Search ID or Metric..."
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                className="pl-9 h-9 w-[220px] bg-background/50 border-border/60 font-mono text-xs focus-visible:ring-primary/30"
                data-testid="input-search-org"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[160px] bg-background/50 border-border/60 font-mono text-xs">
                <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                <SelectValue placeholder="All Nodes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="font-mono text-xs">All Nodes</SelectItem>
                <SelectItem value="ok" className="font-mono text-xs text-emerald-400">OK</SelectItem>
                <SelectItem value="warning" className="font-mono text-xs text-amber-400">Warning</SelectItem>
                <SelectItem value="critical" className="font-mono text-xs text-rose-500">Critical</SelectItem>
                <SelectItem value="emergency" className="font-mono text-xs text-pink-500">Emergency</SelectItem>
                <SelectItem value="immediate" className="font-mono text-xs text-purple-400">Immediate</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <SortableHead col="metric" label="Metric ID" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="left" />
                <TableHead className="text-muted-foreground/70 text-[11px] font-semibold uppercase tracking-wider w-20 bg-card/40">FIN ID</TableHead>
                <SortableHead col="remainingBalance" label="Balance" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortableHead col="dailyConsumption" label="Avg Rate/D" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" title="Average daily consumption based on the previous 30 days" />
                <SortableHead col="historyCoverageDays" label="History" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" title="Valid complete daily intervals in the latest contiguous history run" />
                <SortableHead col="dailyBalanceChange" label="Day Δ" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" title="Yesterday's balance movement versus the prior day" />
                <SortableHead col="daysRemaining" label="Est. TTL" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" title="Estimated days remaining based on average daily consumption rate" />
                <SortableHead col="severity" label="Status Node" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="left" />
                <SortableHead col="lastUpdated" label="Timestamp" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingBalances ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-border/40">
                    <TableCell><Skeleton className="h-4 w-32 bg-border/40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12 bg-border/40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto bg-border/40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto bg-border/40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-10 ml-auto bg-border/40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-14 ml-auto bg-border/40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-12 ml-auto bg-border/40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 bg-border/40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto bg-border/40" /></TableCell>
                  </TableRow>
                ))
              ) : filteredBalances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground gap-3">
                      <div className="h-12 w-12 rounded-full border border-dashed border-muted-foreground/30 flex items-center justify-center">
                        <Search className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                      <p className="font-mono text-sm">
                        {balances?.length === 0
                          ? "NO SIGNAL. Verify connection in settings."
                          : "ZERO MATCHES for current filter set."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredBalances.map((balance: ClientBalance, idx) => {
                  const styles = getSeverityStyles(balance.severity);
                  return (
                    <TableRow
                      key={balance.metric}
                      className="border-border/40 hover:bg-white/[0.02] transition-colors cursor-pointer group relative"
                      onClick={() => setSelectedClient({ metric: balance.metric, severity: balance.severity })}
                      title="Click to view detailed telemetry"
                      data-testid={`row-balance-${idx}`}
                    >
                      {/* Hover Indicator */}
                      <td className="absolute left-0 top-0 bottom-0 w-0.5 bg-transparent group-hover:bg-primary transition-colors" />

                      <TableCell className="font-mono text-xs font-semibold">
                        <span className="flex items-center gap-2">
                          <span className="truncate max-w-[200px] text-foreground/90">{balance.metric}</span>
                          <BarChart2 className="w-3.5 h-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0 shadow-[0_0_8px_rgba(var(--primary),0.5)] rounded-sm" />
                        </span>
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground/60 font-mono w-20">
                        {balance.financeId ?? <span className="opacity-30">---</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        <span className={balance.remainingBalance < 0 ? "text-rose-400 font-bold" : "text-foreground/80"}>
                          {formatBalance(balance.remainingBalance)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground/80">
                        {balance.dailyConsumption > 0 ? (
                          `${formatBalance(balance.dailyConsumption)}/d`
                        ) : balance.recentDailyConsumption > 0 ? (
                          <span title="Based on last 7-day rate (prev. month data unavailable)" className="text-amber-400/80">
                            ~{formatBalance(balance.recentDailyConsumption)}/d
                          </span>
                        ) : (
                          <span className="opacity-30">---</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {balance.historyCoverageDays > 0 ? (
                          <span className="font-mono text-[10px] bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">
                            {balance.historyCoverageDays}D
                          </span>
                        ) : (
                          <span className="text-muted-foreground opacity-30 text-xs font-mono">---</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {balance.dailyBalanceChange === null ? (
                          <span className="text-muted-foreground opacity-30 text-xs font-mono">---</span>
                        ) : (
                          <span className={`font-mono text-xs font-bold ${
                            balance.dailyBalanceChange > 0
                              ? "text-emerald-400"
                              : balance.dailyBalanceChange < 0
                              ? "text-rose-400"
                              : "text-muted-foreground/60"
                          }`}>
                            {balance.dailyBalanceChange > 0 ? "+" : ""}
                            {formatBalance(balance.dailyBalanceChange)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-sm">
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center gap-1.5 cursor-help ${balance.daysRemaining < 30 ? "text-foreground" : "text-muted-foreground"}`}>
                                {balance.daysRemaining < 0 ? (
                                  <span className="text-muted-foreground/50 font-normal text-xs">N/A</span>
                                ) : (
                                  <span className="inline-flex items-baseline gap-0.5">
                                    {balance.daysRemaining}
                                    {balance.usingFallbackRate && (
                                      <span className="text-[10px] font-normal text-amber-500/80 leading-none">~</span>
                                    )}
                                  </span>
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="left"
                              className="max-w-[240px] p-0 bg-popover text-popover-foreground border border-border shadow-xl rounded-md overflow-hidden"
                            >
                              <div className="p-3 bg-card border-b border-border/50">
                                <p className="text-[10px] font-bold tracking-widest text-foreground uppercase flex items-center gap-1.5">
                                  <Info className="w-3 h-3 text-primary" />
                                  TTL Breakdown
                                </p>
                              </div>
                              <div className="p-3 space-y-2.5">
                                {balance.usingFallbackRate && (
                                  <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded text-[10px] text-amber-400 leading-relaxed font-mono">
                                    <TriangleAlert className="w-3 h-3 inline mr-1 -mt-0.5" />
                                    Estimated from 7-day rate (prev. month data unavailable)
                                  </div>
                                )}
                                <div className="flex justify-between gap-4 text-xs">
                                  <span className="text-muted-foreground">Burn Rate</span>
                                  <span className="font-mono font-semibold text-foreground">
                                    {balance.usingFallbackRate
                                      ? formatBalance(balance.recentDailyConsumption)
                                      : formatBalance(balance.dailyConsumption)}/d
                                  </span>
                                </div>
                                <div className="flex justify-between gap-4 text-xs">
                                  <span className="text-muted-foreground">Balance</span>
                                  <span className="font-mono font-semibold text-foreground">
                                    {formatBalance(balance.remainingBalance)}
                                  </span>
                                </div>
                                <div className="pt-2 mt-2 border-t border-border/40 flex justify-between gap-4 text-xs">
                                  <span className="text-muted-foreground font-semibold">Projected TTL</span>
                                  <span className="font-mono font-bold text-primary">
                                    {balance.daysRemaining < 0 ? "UNKNOWN" : `${balance.daysRemaining} DAYS`}
                                  </span>
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <div className={`inline-flex items-center px-2 py-1 rounded border text-[10px] font-bold tracking-wider uppercase font-mono ${styles.bg} ${styles.text} ${styles.border}`}>
                          {getSeverityIcon(balance.severity)}
                          {balance.severity}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground/50">
                        {balance.lastUpdated ? format(new Date(balance.lastUpdated), "HH:mm") : "---"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <OrganizationStudyDialog
        metric={selectedClient?.metric ?? null}
        fallbackSeverity={selectedClient?.severity ?? "ok"}
        onClose={() => setSelectedClient(null)}
        onSelectMetric={(metric) => {
          const existing = balances?.find((b) => b.metric === metric);
          setSelectedClient({ metric, severity: existing?.severity ?? "ok" });
        }}
      />
    </div>
  );
}
