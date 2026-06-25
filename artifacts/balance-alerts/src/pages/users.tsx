import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserCog, Plus, MoreHorizontal, ShieldCheck, Lock, RefreshCw, Power, KeyRound } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AppUser {
  id: number;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  totpEnabled: boolean;
  mustSetupTotp: boolean;
  mustChangePw: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

const api = async (url: string, method = "GET", body?: object) => {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error((data["error"] as string) ?? "Request failed");
  return data;
};

export default function UsersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const QKEY = ["users"];

  const { data: users = [], isLoading } = useQuery<AppUser[]>({
    queryKey: QKEY,
    queryFn: () => api("/api/users").then((d) => d as unknown as AppUser[]),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [tempPwDialog, setTempPwDialog] = useState<{ username: string; pw: string } | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("viewer");

  const invalidate = () => qc.invalidateQueries({ queryKey: QKEY });

  const mutate = useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: string; body?: object }) =>
      api(url, method, body),
    onSuccess: () => invalidate(),
    onError: (err) => toast({ variant: "destructive", title: "Error", description: (err as Error).message }),
  });

  const createUser = async () => {
    try {
      const data = await api("/api/users", "POST", {
        username: newUsername,
        email: newEmail,
        role: newRole,
      });
      setCreateOpen(false);
      setNewUsername(""); setNewEmail(""); setNewRole("viewer");
      invalidate();
      setTempPwDialog({ username: newUsername, pw: data["tempPassword"] as string });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message });
    }
  };

  const act = (url: string, method = "POST", body?: object) =>
    mutate.mutate({ url, method, body });

  const badge = (user: AppUser) => {
    if (!user.isActive) return <Badge variant="secondary">Inactive</Badge>;
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date())
      return <Badge variant="destructive">Locked</Badge>;
    return <Badge variant="outline" className="text-green-400 border-green-400/30">Active</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCog className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
            <p className="text-sm text-muted-foreground">Manage application accounts and access.</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" /> Create User
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>TOTP</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!isLoading && users.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No users found.</TableCell></TableRow>
            )}
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.username}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                <TableCell>
                  <Badge variant={user.role === "admin" ? "default" : "secondary"} className="capitalize">
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>{badge(user)}</TableCell>
                <TableCell>
                  {user.totpEnabled
                    ? <ShieldCheck className="h-4 w-4 text-green-400" />
                    : <span className="text-xs text-muted-foreground">
                        {user.mustSetupTotp ? "Pending setup" : "—"}
                      </span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {user.lastLoginAt
                    ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })
                    : "Never"}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => act(`/api/users/${user.id}`, "PATCH", {
                          role: user.role === "admin" ? "viewer" : "admin",
                        })}
                      >
                        <KeyRound className="mr-2 h-3.5 w-3.5" />
                        Make {user.role === "admin" ? "Viewer" : "Admin"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => act(`/api/users/${user.id}/reset-totp`)}>
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        Reset TOTP
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={async () => {
                          const data = await api(`/api/users/${user.id}/force-pw-reset`, "POST");
                          setTempPwDialog({ username: user.username, pw: data["tempPassword"] as string });
                          invalidate();
                        }}
                      >
                        <Lock className="mr-2 h-3.5 w-3.5" />
                        Force Password Reset
                      </DropdownMenuItem>
                      {user.lockedUntil && new Date(user.lockedUntil) > new Date() && (
                        <DropdownMenuItem onClick={() => act(`/api/users/${user.id}/unlock`)}>
                          <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                          Unlock Account
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className={user.isActive ? "text-destructive focus:text-destructive" : ""}
                        onClick={() => act(`/api/users/${user.id}`, "PATCH", { isActive: !user.isActive })}
                      >
                        <Power className="mr-2 h-3.5 w-3.5" />
                        {user.isActive ? "Deactivate" : "Reactivate"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="johndoe" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="john@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              A temporary password will be generated and shown once. The user must set up TOTP
              and change their password on first login.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createUser} disabled={!newUsername || !newEmail}>Create User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Temp password reveal dialog */}
      <AlertDialog open={!!tempPwDialog} onOpenChange={(o) => !o && setTempPwDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Temporary Password — Copy Now</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Share this with <strong>{tempPwDialog?.username}</strong>. It will not be shown again.</p>
                <div className="rounded-md bg-muted px-4 py-3 font-mono text-sm text-center tracking-wider select-all">
                  {tempPwDialog?.pw}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setTempPwDialog(null)}>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
