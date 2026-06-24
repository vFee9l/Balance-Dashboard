import { 
  useListAlertHistory, 
  getListAlertHistoryQueryKey 
} from "@workspace/api-client-react";
import type { AlertHistoryEntry } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { CheckCircle2, XCircle, Mail, MessageSquare, Send } from "lucide-react";

function parseRecipients(entry: AlertHistoryEntry): React.ReactNode {
  if (!entry.recipients) return null;
  try {
    const r = JSON.parse(entry.recipients) as Record<string, unknown>;
    const ch = entry.channel.toLowerCase();
    if (ch === "sms") {
      const nums = (r.numbers as string[] | undefined) ?? [];
      if (!nums.length) return <span className="text-muted-foreground">No numbers</span>;
      return (
        <div className="space-y-0.5">
          {nums.map((n) => (
            <div key={n} className="font-mono">{n}</div>
          ))}
        </div>
      );
    }
    if (ch === "email" || ch === "smtp") {
      const to = (r.to as string[] | undefined) ?? [];
      const cc = (r.cc as string[] | undefined) ?? [];
      if (!to.length && !cc.length) return <span className="text-muted-foreground">No recipients</span>;
      return (
        <div className="space-y-1.5 text-left">
          {to.length > 0 && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold">To</span>
              {to.map((e) => <div key={e} className="font-mono text-xs">{e}</div>)}
            </div>
          )}
          {cc.length > 0 && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold">CC</span>
              {cc.map((e) => <div key={e} className="font-mono text-xs">{e}</div>)}
            </div>
          )}
        </div>
      );
    }
    if (ch === "telegram") {
      return <span className="font-mono">Chat ID: {String(r.chatId ?? "broadcast")}</span>;
    }
    return <span className="font-mono text-xs">{entry.recipients}</span>;
  } catch {
    return <span className="font-mono text-xs">{entry.recipients}</span>;
  }
}

export default function History() {
  const { data: history, isLoading } = useListAlertHistory({
    query: { queryKey: getListAlertHistoryQueryKey() }
  });

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "ok": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "warning": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "critical": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "emergency": return "bg-red-900/40 text-red-400 border-red-500/40";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel.toLowerCase()) {
      case "sms": return <MessageSquare className="w-3 h-3 mr-1 inline" />;
      case "smtp":
      case "email": return <Mail className="w-3 h-3 mr-1 inline" />;
      case "telegram": return <Send className="w-3 h-3 mr-1 inline" />;
      default: return null;
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transmission Log</h1>
          <p className="text-muted-foreground mt-1">Immutable audit trail of all automated alerts.</p>
        </div>

        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Timestamp</TableHead>
                  <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Client/Metric</TableHead>
                  <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase text-right">Days Left</TableHead>
                  <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Severity</TableHead>
                  <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Channel</TableHead>
                  <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase text-right">Recipients</TableHead>
                  <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i} className="border-border/50">
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : history?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No alert history available.
                    </TableCell>
                  </TableRow>
                ) : (
                  history?.map((entry) => {
                    const recipientNode = parseRecipients(entry);
                    return (
                      <TableRow key={entry.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {format(new Date(entry.sentAt), 'yyyy-MM-dd HH:mm:ss')}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-foreground">{entry.metric}</TableCell>
                        <TableCell className="text-right font-bold">{entry.daysRemaining}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`uppercase text-[10px] tracking-widest font-bold ${getSeverityColor(entry.severity)}`}>
                            {entry.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-[10px] tracking-widest bg-secondary/50 text-secondary-foreground border-border/50">
                            {getChannelIcon(entry.channel)}
                            {entry.channel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{entry.recipientCount}</TableCell>
                        <TableCell className="text-right">
                          {entry.success ? (
                            recipientNode ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center justify-end text-green-500 text-sm font-medium cursor-help">
                                    <CheckCircle2 className="w-4 h-4 mr-1" />
                                    SUCCESS
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs text-xs bg-popover border-border text-popover-foreground">
                                  {recipientNode}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <div className="flex items-center justify-end text-green-500 text-sm font-medium">
                                <CheckCircle2 className="w-4 h-4 mr-1" />
                                SUCCESS
                              </div>
                            )
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-end text-destructive text-sm font-medium cursor-help">
                                  <XCircle className="w-4 h-4 mr-1" />
                                  FAILED
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="left"
                                className="max-w-xs text-xs bg-destructive/10 border-destructive/30 text-destructive-foreground space-y-2"
                              >
                                <p className="font-semibold">{entry.errorMessage || "Unknown error"}</p>
                                {recipientNode && (
                                  <div className="border-t border-destructive/20 pt-2 text-muted-foreground">
                                    {recipientNode}
                                  </div>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
