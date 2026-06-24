import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, Clock, Bot, Shield, Users, List, Search,
  Download, Plus, Trash2, RefreshCw, Lock, Unlock, UserX, ShieldAlert,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TelegramUser {
  id: number;
  telegramId: number;
  telegramUsername: string | null;
  name: string;
  email: string;
  status: string;
  role: string;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  lastActiveAt: string | null;
  sessionExpiresAt: string | null;
}

interface WhitelistEntry {
  id: number;
  telegramUsername: string;
  addedBy: string | null;
  addedAt: string | null;
  note: string | null;
}

interface AuditEntry {
  id: number;
  telegramId: number | null;
  username: string | null;
  command: string | null;
  args: string | null;
  result: string | null;
  detail: string | null;
  createdAt: string;
}

// ─── Badges ───────────────────────────────────────────────────────────────────
function statusBadge(status: string) {
  switch (status) {
    case "approved": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20 uppercase text-[10px] tracking-widest font-bold">Approved</Badge>;
    case "rejected": return <Badge className="bg-red-500/10 text-red-500 border-red-500/20 uppercase text-[10px] tracking-widest font-bold">Rejected</Badge>;
    case "suspended": return <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20 uppercase text-[10px] tracking-widest font-bold">Suspended</Badge>;
    default: return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 uppercase text-[10px] tracking-widest font-bold">Pending</Badge>;
  }
}

function roleBadge(role: string) {
  switch (role) {
    case "admin": return <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 uppercase text-[10px] tracking-widest font-bold">Admin</Badge>;
    case "operator": return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 uppercase text-[10px] tracking-widest font-bold">Operator</Badge>;
    default: return <Badge className="bg-secondary text-secondary-foreground border-border/50 uppercase text-[10px] tracking-widest font-bold">Viewer</Badge>;
  }
}

function resultBadge(result: string | null) {
  switch (result) {
    case "success": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">success</Badge>;
    case "denied": return <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px]">denied</Badge>;
    case "rate_limited": return <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20 text-[10px]">rate_limited</Badge>;
    case "error": return <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">error</Badge>;
    default: return <Badge variant="outline" className="text-[10px]">{result ?? "—"}</Badge>;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BotUsers() {
  const { toast } = useToast();
  const [tab, setTab] = useState("users");

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Bot className="w-7 h-7 text-primary" />
            Bot Management
          </h1>
          <p className="text-muted-foreground mt-1">Manage Telegram bot users, whitelist, and audit trail.</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full max-w-lg grid-cols-3 mb-6">
            <TabsTrigger value="users" className="gap-2"><Users className="w-4 h-4" />Users</TabsTrigger>
            <TabsTrigger value="whitelist" className="gap-2"><Shield className="w-4 h-4" />Whitelist</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2"><List className="w-4 h-4" />Audit Log</TabsTrigger>
          </TabsList>

          <TabsContent value="users"><UsersTab toast={toast} /></TabsContent>
          <TabsContent value="whitelist"><WhitelistTab toast={toast} /></TabsContent>
          <TabsContent value="audit"><AuditTab toast={toast} /></TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────────
function UsersTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setActionPending] = useState<string | null>(null);
  const [suspendDialog, setSuspendDialog] = useState<{ userId: number; open: boolean }>({ userId: 0, open: false });
  const [suspendReason, setSuspendReason] = useState("");
  const [filter, setFilter] = useState("");

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      setUsers(await res.json() as TelegramUser[]);
    } catch {
      toast({ variant: "destructive", title: "Failed to load Bot Users" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchUsers(); const t = setInterval(() => void fetchUsers(), 30_000); return () => clearInterval(t); }, [fetchUsers]);

  const act = async (id: number, action: string, body?: object) => {
    setActionPending(`${id}:${action}`);
    try {
      const res = await fetch(`/api/telegram/users/${id}/${action}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) { const d = await res.json() as { error: string }; throw new Error(d.error); }
      toast({ title: `Action: ${action}`, description: "Updated successfully. Notification sent." });
      await fetchUsers();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Action failed", description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setActionPending(null);
    }
  };

  const q = filter.toLowerCase();
  const filtered = users.filter(u =>
    !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) ||
    (u.telegramUsername ?? "").toLowerCase().includes(q) || String(u.telegramId).includes(q)
  );
  const pendingCount = users.filter(u => u.status === "pending").length;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30 text-xs font-bold">
              {pendingCount} pending
            </Badge>
          )}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search name, email, @username…" className="pl-8 h-8 text-sm bg-background" value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchUsers()} className="gap-2 h-8">
          <RefreshCw className="w-3.5 h-3.5" />Refresh
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                {["Name", "Email", "Telegram", "Role", "Status", "Last Active", "Failures", "Actions"].map(h => (
                  <TableHead key={h} className="font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    {Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    {filter ? "No users match your search." : "No bot users yet."}
                  </TableCell>
                </TableRow>
              ) : filtered.map(user => {
                const isLocked = user.lockedUntil && new Date(user.lockedUntil) > new Date();
                const key = pending;
                return (
                  <TableRow key={user.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium max-w-[140px] truncate">
                      <Tooltip>
                        <TooltipTrigger className="text-left">{user.name}</TooltipTrigger>
                        <TooltipContent>ID: {user.telegramId}{user.suspendedReason ? `\nReason: ${user.suspendedReason}` : ""}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate">{user.email}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {user.telegramUsername ? `@${user.telegramUsername}` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role || "viewer"}
                        onValueChange={(role) => void act(user.id, "role", { role })}
                        disabled={key === `${user.id}:role`}
                      >
                        <SelectTrigger className="h-7 w-[90px] text-[10px] border-border/50 bg-transparent">
                          <SelectValue>{roleBadge(user.role)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="operator">Operator</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {statusBadge(user.status)}
                        {isLocked && (
                          <Tooltip>
                            <TooltipTrigger><Lock className="w-3 h-3 text-orange-400" /></TooltipTrigger>
                            <TooltipContent>Locked until {format(new Date(user.lockedUntil!), "HH:mm dd/MM")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {user.lastActiveAt ? formatDistanceToNow(new Date(user.lastActiveAt), { addSuffix: true }) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {user.failedAttempts > 0 ? (
                        <Badge variant="outline" className="text-orange-400 border-orange-500/30 text-[10px]">{user.failedAttempts}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end flex-wrap">
                        {user.status === "pending" && (
                          <>
                            <Button size="sm" variant="outline" className="text-green-500 border-green-500/30 hover:bg-green-500/10 h-7 px-2 text-[10px]" disabled={!!pending} onClick={() => void act(user.id, "approve")}>
                              <CheckCircle2 className="w-3 h-3 mr-1" />Approve
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 h-7 px-2 text-[10px]" disabled={!!pending} onClick={() => void act(user.id, "reject")}>
                              <XCircle className="w-3 h-3 mr-1" />Reject
                            </Button>
                          </>
                        )}
                        {user.status === "approved" && (
                          <Button size="sm" variant="outline" className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10 h-7 px-2 text-[10px]" disabled={!!pending} onClick={() => { setSuspendDialog({ userId: user.id, open: true }); setSuspendReason(""); }}>
                            <UserX className="w-3 h-3 mr-1" />Suspend
                          </Button>
                        )}
                        {user.status === "suspended" && (
                          <Button size="sm" variant="outline" className="text-green-500 border-green-500/30 hover:bg-green-500/10 h-7 px-2 text-[10px]" disabled={!!pending} onClick={() => void act(user.id, "approve")}>
                            <CheckCircle2 className="w-3 h-3 mr-1" />Reinstate
                          </Button>
                        )}
                        {isLocked && (
                          <Button size="sm" variant="outline" className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10 h-7 px-2 text-[10px]" disabled={!!pending} onClick={() => void act(user.id, "unlock")}>
                            <Unlock className="w-3 h-3 mr-1" />Unlock
                          </Button>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-foreground" disabled={!!pending} onClick={() => void act(user.id, "reset-session")}>
                              <RefreshCw className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Reset session (force re-register)</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={suspendDialog.open} onOpenChange={(o) => setSuspendDialog(p => ({ ...p, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-orange-400" />Suspend User</DialogTitle>
            <DialogDescription>The user will be notified and immediately blocked from all bot commands.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Textarea placeholder="Enter suspension reason…" value={suspendReason} onChange={e => setSuspendReason(e.target.value)} className="bg-background resize-none" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendDialog(p => ({ ...p, open: false }))}>Cancel</Button>
            <Button variant="destructive" disabled={!!pending} onClick={async () => {
              setSuspendDialog(p => ({ ...p, open: false }));
              await act(suspendDialog.userId, "suspend", { reason: suspendReason });
            }}>Suspend User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Whitelist tab ────────────────────────────────────────────────────────────
function WhitelistTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/whitelist", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      setEntries(await res.json() as WhitelistEntry[]);
    } catch {
      toast({ variant: "destructive", title: "Failed to load whitelist" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  const handleAdd = async () => {
    const u = newUsername.trim().replace(/^@/, "");
    if (!u) return;
    setSaving(true);
    try {
      const res = await fetch("/api/telegram/whitelist", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, note: newNote.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json() as { error: string }; throw new Error(d.error); }
      toast({ title: `@${u} added to whitelist` });
      setNewUsername(""); setNewNote("");
      await fetchList();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Failed", description: e instanceof Error ? e.message : "Error" });
    } finally { setSaving(false); }
  };

  const handleRemove = async (id: number, username: string) => {
    setRemoving(id);
    try {
      await fetch(`/api/telegram/whitelist/${id}`, { method: "DELETE", credentials: "include" });
      toast({ title: `@${username} removed from whitelist` });
      await fetchList();
    } catch {
      toast({ variant: "destructive", title: "Failed to remove entry" });
    } finally { setRemoving(null); }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />Add to Whitelist</CardTitle>
          <CardDescription>Only users on this list can send /register to the bot when whitelist enforcement is enabled.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="@username (without @)"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                onKeyDown={e => e.key === "Enter" && void handleAdd()}
                className="bg-background font-mono text-sm"
              />
              <Input
                placeholder="Note (optional)"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                className="bg-background text-sm w-48"
              />
            </div>
            <Button onClick={() => void handleAdd()} disabled={!newUsername.trim() || saving} className="shrink-0">
              <Plus className="w-4 h-4 mr-1" />Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                {["Username", "Note", "Added By", "Added At", ""].map((h, i) => (
                  <TableHead key={i} className="font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    {Array.from({ length: 5 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground text-sm">
                    Whitelist is empty. Add usernames above.
                  </TableCell>
                </TableRow>
              ) : entries.map(e => (
                <TableRow key={e.id} className="border-border/50 hover:bg-muted/50">
                  <TableCell className="font-mono text-sm font-medium">@{e.telegramUsername}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.note || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.addedBy || "admin"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {e.addedAt ? format(new Date(e.addedAt), "yyyy-MM-dd") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:bg-destructive/10" disabled={removing === e.id} onClick={() => void handleRemove(e.id, e.telegramUsername)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Audit Log tab ────────────────────────────────────────────────────────────
function AuditTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const PAGE_SIZE = 50;

  const [filters, setFilters] = useState({ telegramId: "", command: "", result: "", from: "", to: "" });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchLogs = useCallback(async (p: number, f: typeof filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (f.telegramId) params.set("telegramId", f.telegramId);
      if (f.command) params.set("command", f.command);
      if (f.result) params.set("result", f.result);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      const res = await fetch(`/api/telegram/audit?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as { logs: AuditEntry[]; total: number };
      setLogs(data.logs);
      setTotal(data.total);
    } catch {
      toast({ variant: "destructive", title: "Failed to load audit log" });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void fetchLogs(page, filters); }, []);

  const handleSearch = () => { setPage(1); void fetchLogs(1, filters); };
  const handlePageChange = (p: number) => { setPage(p); void fetchLogs(p, filtersRef.current); };

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (filters.telegramId) params.set("telegramId", filters.telegramId);
    if (filters.command) params.set("command", filters.command);
    if (filters.result) params.set("result", filters.result);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const url = `/api/telegram/audit/export?${params}`;
    const a = document.createElement("a");
    a.href = url; a.download = `telegram-audit-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Input placeholder="Telegram ID" value={filters.telegramId} onChange={e => setFilters(p => ({ ...p, telegramId: e.target.value }))} className="bg-background text-sm font-mono" />
            <Input placeholder="Command" value={filters.command} onChange={e => setFilters(p => ({ ...p, command: e.target.value }))} className="bg-background text-sm font-mono" />
            <Select value={filters.result} onValueChange={v => setFilters(p => ({ ...p, result: v === "_all" ? "" : v }))}>
              <SelectTrigger className="bg-background text-sm h-9"><SelectValue placeholder="Result" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All results</SelectItem>
                <SelectItem value="success">success</SelectItem>
                <SelectItem value="denied">denied</SelectItem>
                <SelectItem value="rate_limited">rate_limited</SelectItem>
                <SelectItem value="error">error</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={filters.from} onChange={e => setFilters(p => ({ ...p, from: e.target.value }))} className="bg-background text-sm" />
            <Input type="date" value={filters.to} onChange={e => setFilters(p => ({ ...p, to: e.target.value }))} className="bg-background text-sm" />
          </div>
          <div className="flex justify-between items-center mt-3">
            <span className="text-xs text-muted-foreground">{total.toLocaleString()} entries</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSearch} className="gap-1 h-8"><Search className="w-3.5 h-3.5" />Search</Button>
              <Button variant="outline" size="sm" onClick={() => void handleExport()} className="gap-1 h-8"><Download className="w-3.5 h-3.5" />CSV</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                {["Time", "Telegram ID", "Username", "Command", "Args", "Result", "Detail"].map(h => (
                  <TableHead key={h} className="font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    {Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-20 text-center text-muted-foreground text-sm">No audit entries found.</TableCell>
                </TableRow>
              ) : logs.map(l => (
                <TableRow key={l.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                  <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(l.createdAt), "MM-dd HH:mm:ss")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.telegramId ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{l.username ? `@${l.username}` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs font-medium">{l.command ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                    <Tooltip>
                      <TooltipTrigger className="text-left">{l.args || "—"}</TooltipTrigger>
                      {l.args ? <TooltipContent className="font-mono text-xs max-w-xs break-all">{l.args}</TooltipContent> : null}
                    </Tooltip>
                  </TableCell>
                  <TableCell>{resultBadge(l.result)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                    <Tooltip>
                      <TooltipTrigger className="text-left">{l.detail || "—"}</TooltipTrigger>
                      {l.detail ? <TooltipContent className="text-xs max-w-xs break-all">{l.detail}</TooltipContent> : null}
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Page {page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
