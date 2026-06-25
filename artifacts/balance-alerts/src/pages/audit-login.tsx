import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClipboardList, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

interface AuditRow {
  id: number;
  username: string | null;
  result: string | null;
  ipAddress: string | null;
  createdAt: string | null;
}

interface AuditResponse {
  rows: AuditRow[];
  page: number;
  pageSize: number;
}

const RESULT_COLORS: Record<string, string> = {
  success:      "text-green-400 border-green-400/30",
  bad_password: "text-red-400 border-red-400/30",
  totp_failed:  "text-orange-400 border-orange-400/30",
  locked:       "text-yellow-400 border-yellow-400/30",
  inactive:     "text-gray-400 border-gray-400/30",
};

export default function AuditLoginPage() {
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState("");
  const [result, setResult] = useState("all");
  const PAGE_SIZE = 50;

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    ...(username ? { username } : {}),
    ...(result && result !== "all" ? { result } : {}),
  });

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["audit", "login", page, username, result],
    queryFn: async () => {
      const r = await fetch(`/api/audit/login?${params.toString()}`, { credentials: "include" });
      return r.json() as Promise<AuditResponse>;
    },
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];

  const applyFilters = () => setPage(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Login Audit Log</h1>
          <p className="text-sm text-muted-foreground">All authentication events.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Username</p>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Filter by username"
            className="h-8 w-48 text-sm"
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Result</p>
          <Select value={result} onValueChange={(v) => { setResult(v); setPage(1); }}>
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue placeholder="All results" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="bad_password">Bad password</SelectItem>
              <SelectItem value="totp_failed">TOTP failed</SelectItem>
              <SelectItem value="locked">Locked</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={applyFilters} className="h-8">
          Apply
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>IP Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No records found.</TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {row.createdAt ? format(new Date(row.createdAt), "MMM d, yyyy HH:mm:ss") : "—"}
                </TableCell>
                <TableCell className="font-medium">{row.username ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={RESULT_COLORS[row.result ?? ""] ?? ""}
                  >
                    {row.result ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono">
                  {row.ipAddress ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-3 justify-end">
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button
          size="sm" variant="outline" className="h-8 w-8 p-0"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="sm" variant="outline" className="h-8 w-8 p-0"
          disabled={rows.length < PAGE_SIZE}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
