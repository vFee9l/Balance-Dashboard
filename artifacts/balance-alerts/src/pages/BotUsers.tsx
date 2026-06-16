import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Clock, Bot } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface TelegramUser {
  id: number;
  telegramId: number;
  telegramUsername: string | null;
  name: string;
  email: string;
  status: string;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "approved": return <Badge className="bg-green-500/10 text-green-500 border-green-500/20 uppercase text-[10px] tracking-widest">Approved</Badge>;
    case "rejected": return <Badge className="bg-red-500/10 text-red-500 border-red-500/20 uppercase text-[10px] tracking-widest">Rejected</Badge>;
    default: return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 uppercase text-[10px] tracking-widest">Pending</Badge>;
  }
}

export default function BotUsers() {
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json() as TelegramUser[];
      setUsers(data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load Bot Users" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchUsers();
    const interval = setInterval(() => void fetchUsers(), 30_000);
    return () => clearInterval(interval);
  }, [fetchUsers]);

  const handleAction = async (id: number, action: "approve" | "reject") => {
    setActionPending(id);
    try {
      const res = await fetch(`/api/telegram/users/${id}/${action}`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Action failed");
      toast({ title: action === "approve" ? "User approved" : "User rejected", description: "Telegram notification sent." });
      await fetchUsers();
    } catch {
      toast({ variant: "destructive", title: "Action failed", description: "Could not update user status." });
    } finally {
      setActionPending(null);
    }
  };

  const pending = users.filter((u) => u.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Bot className="w-7 h-7 text-primary" />
            Bot Users
            {pending > 0 && (
              <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30 text-xs font-bold ml-1">
                {pending} pending
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-1">Manage Telegram bot registration requests.</p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Name</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Email</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Telegram</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Status</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Requested</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No bot users yet. Users register via the Telegram bot.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{user.email}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {user.telegramUsername ? `@${user.telegramUsername}` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{statusBadge(user.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.requestedAt ? format(new Date(user.requestedAt), "yyyy-MM-dd HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {user.status === "pending" ? (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-500 border-green-500/30 hover:bg-green-500/10 h-7 px-2 text-xs"
                            disabled={actionPending === user.id}
                            onClick={() => void handleAction(user.id, "approve")}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/30 hover:bg-destructive/10 h-7 px-2 text-xs"
                            disabled={actionPending === user.id}
                            onClick={() => void handleAction(user.id, "reject")}
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end text-xs text-muted-foreground gap-1">
                          <Clock className="w-3 h-3" />
                          {user.reviewedAt ? format(new Date(user.reviewedAt), "yyyy-MM-dd") : "—"}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
