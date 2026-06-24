import { useState, useEffect, useRef } from "react";
import {
  useGetSettings,
  getGetSettingsQueryKey,
  useUpdateSettings,
  useVerifyOtp,
  useGetTotpSetup,
} from "@workspace/api-client-react";
import type { SettingsUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Lock, Unlock, KeyRound, Server, Mail, MessageSquare, Send, Clock, Save, QrCode, ShieldCheck, Copy, CheckCheck, Bot, Eye, EyeOff, Table2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

function TotpSetupCard({ onEnabled }: { onEnabled: () => void }) {
  const { data: setup, isLoading } = useGetTotpSetup();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copySecret = () => {
    if (setup?.secret) {
      navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEnable = async () => {
    await updateSettings.mutateAsync({ data: { totpEnabled: true } });
    toast({ title: "TOTP enabled", description: "Google Authenticator is now required to access settings." });
    onEnabled();
  };

  if (isLoading) return <div className="text-center py-8 text-muted-foreground text-sm">Loading setup…</div>;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">Scan this QR code with <span className="text-foreground font-medium">Google Authenticator</span></p>
        <p className="text-xs text-muted-foreground">or any TOTP-compatible app (Authy, 1Password, etc.)</p>
      </div>
      {setup?.qrCodeUrl && (
        <div className="flex justify-center">
          <div className="p-3 bg-white rounded-xl">
            <img src={setup.qrCodeUrl} alt="TOTP QR Code" className="w-48 h-48" />
          </div>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center">Can't scan? Enter this secret manually:</p>
        <div className="flex items-center gap-2 bg-background rounded-md px-3 py-2 border border-border font-mono text-xs tracking-widest">
          <span className="flex-1 select-all truncate">{setup?.secret}</span>
          <button type="button" onClick={copySecret} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            {copied ? <CheckCheck className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <Button type="button" className="w-full font-bold tracking-wider" onClick={handleEnable} disabled={updateSettings.isPending}>
        <ShieldCheck className="w-4 h-4 mr-2" />
        {updateSettings.isPending ? "ENABLING..." : "I'VE SCANNED IT — ENABLE TOTP"}
      </Button>
    </div>
  );
}

function TelegramBotCard() {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "disconnected">("idle");
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/telegram/status", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { connected: boolean; botUsername: string | null; enabled: boolean }) => {
        setStatus(d.connected ? "connected" : d.enabled ? "disconnected" : "idle");
        setBotUsername(d.botUsername);
        setEnabled(d.enabled);
      })
      .catch(() => setStatus("idle"));
  }, []);

  const handleSave = async () => {
    if (!token.trim()) {
      toast({ variant: "destructive", title: "Token required", description: "Enter a bot token from BotFather." });
      return;
    }
    setSaving(true);
    setStatus("connecting");
    try {
      const res = await fetch("/api/settings/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_token: token.trim() }),
      });
      const data = await res.json() as { ok?: boolean; connected?: boolean; botUsername?: string; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to save");
      }
      setStatus("connected");
      setBotUsername(data.botUsername ?? null);
      setEnabled(true);
      setToken("");
      toast({ title: "Bot connected", description: `@${data.botUsername ?? "bot"} is now running.` });
    } catch (err) {
      setStatus("disconnected");
      toast({ variant: "destructive", title: "Connection failed", description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (val: boolean) => {
    if (val) return;
    setSaving(true);
    try {
      await fetch("/api/settings/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: false }),
      });
      setStatus("disconnected");
      setEnabled(false);
      toast({ title: "Bot disabled", description: "The Telegram bot has been stopped." });
    } catch {
      toast({ variant: "destructive", title: "Failed to disable bot" });
    } finally {
      setSaving(false);
    }
  };

  const statusEl = () => {
    if (status === "connecting") return <span className="flex items-center gap-1.5 text-yellow-400 text-sm"><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" />Connecting…</span>;
    if (status === "connected") return <span className="flex items-center gap-1.5 text-green-400 text-sm"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Connected{botUsername ? ` — @${botUsername}` : ""}</span>;
    if (status === "disconnected") return <span className="flex items-center gap-1.5 text-red-400 text-sm"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Disconnected</span>;
    return <span className="flex items-center gap-1.5 text-muted-foreground text-sm"><span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />Not configured</span>;
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center">
              <Bot className="w-5 h-5 mr-2 text-primary" />
              Telegram Bot
            </CardTitle>
            <CardDescription>Interactive bot for balance checks and user registration.</CardDescription>
          </div>
          {(status === "connected" || status === "disconnected") && (
            <Switch
              checked={status === "connected"}
              disabled={saving}
              onCheckedChange={handleToggleEnabled}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">{statusEl()}</div>
        <Separator className="border-border/40" />
        <div className="space-y-2">
          <label className="text-sm font-medium">Bot Token</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showToken ? "text" : "password"}
                placeholder="7412356789:AAF3kLmNoPqRsTuVwXyZ…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="bg-background font-mono text-sm pr-10"
                onKeyDown={(e) => e.key === "Enter" && void handleSave()}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button onClick={() => void handleSave()} disabled={saving || !token.trim()} className="shrink-0">
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your token from{" "}
            <a href="https://t.me/botfather" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              @BotFather
            </a>{" "}
            — send <code className="font-mono bg-muted px-1 rounded">/newbot</code> to create one.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otp, setOtp] = useState("");
  const [showTotpSetup, setShowTotpSetup] = useState(false);
  const [totpRequired, setTotpRequired] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/settings/totp-status")
      .then((r) => r.json())
      .then((data: { required: boolean }) => {
        setTotpRequired(data.required);
        if (!data.required) {
          setIsAuthenticated(true);
        }
      })
      .catch(() => setTotpRequired(false));
  }, []);

  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), enabled: isAuthenticated }
  });

  const updateSettingsMutation = useUpdateSettings();
  const verifyOtpMutation = useVerifyOtp();

  const [testSmsTo, setTestSmsTo] = useState("");
  const [testSmsSending, setTestSmsSending] = useState(false);

  const handleTestSms = async () => {
    if (!testSmsTo.trim()) {
      toast({ variant: "destructive", title: "Missing number", description: "Enter a recipient phone number." });
      return;
    }
    setTestSmsSending(true);
    try {
      const res = await fetch("/api/settings/test-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testSmsTo.trim() }),
      });
      const data = await res.json() as { success: boolean; error?: string; sentBody?: string };
      if (data.success) {
        toast({ title: "Test SMS sent", description: `Delivered to ${testSmsTo}` });
      } else {
        toast({
          variant: "destructive",
          title: "SMS failed",
          description: (
            <div className="space-y-1 text-xs">
              <p>{data.error}</p>
              {data.sentBody && <p className="font-mono opacity-70 break-all">Sent: {data.sentBody}</p>}
            </div>
          ) as unknown as string,
        });
      }
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Network error", description: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setTestSmsSending(false);
    }
  };

  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailSending, setTestEmailSending] = useState(false);

  const handleTestEmail = async () => {
    if (!testEmailTo.includes("@")) {
      toast({ variant: "destructive", title: "Invalid address", description: "Enter a valid recipient email." });
      return;
    }
    setTestEmailSending(true);
    try {
      const res = await fetch("/api/settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmailTo }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        toast({ title: "Test email sent", description: `Delivered to ${testEmailTo}` });
      } else {
        toast({ variant: "destructive", title: "Send failed", description: data.error ?? "Unknown SMTP error." });
      }
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Network error", description: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setTestEmailSending(false);
    }
  };

  const form = useForm<SettingsUpdate>({
    defaultValues: {
      smsEnabled: false,
      smtpEnabled: false,
      smtpTls: false,
      telegramEnabled: false,
      scheduleEnabled: true,
      scheduleHour: 8,
      thresholdStaff: 20,
      thresholdManager: 15,
      thresholdMd: 5,
      warningSmsCols: "F,H",
      warningEmailToCols: "G,I",
      warningEmailCcCols: "K",
      criticalSmsCols: "F,H,J",
      criticalEmailToCols: "K",
      criticalEmailCcCols: "G,I,M",
      emergencySmsCols: "F,H,J,L",
      emergencyEmailToCols: "M",
      emergencyEmailCcCols: "G,I,K",
    },
  });
  const initializedRef = useRef(false);

  useEffect(() => {
    if (settings && !initializedRef.current) {
      const cleaned = Object.fromEntries(
        Object.entries(settings).map(([k, v]) => [k, v === null ? undefined : v])
      ) as SettingsUpdate;
      form.reset(cleaned);
      initializedRef.current = true;
    }
  }, [settings, form]);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || otp.length < 6) return;
    try {
      const result = await verifyOtpMutation.mutateAsync({ data: { otp } });
      if (result.success) {
        setIsAuthenticated(true);
        toast({ title: "Access granted", description: "System configuration is now unlocked." });
      }
    } catch (error: any) {
      const msg = error?.response?.data?.error || error.message || "Invalid code.";
      toast({ variant: "destructive", title: "Authentication failed", description: msg });
      setOtp("");
    }
  };

  const onSubmit = async (data: SettingsUpdate) => {
    try {
      await updateSettingsMutation.mutateAsync({ data });
      toast({ title: "Configuration saved", description: "Settings updated successfully." });
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error saving settings", description: error.message || "Unknown error." });
    }
  };

  if (totpRequired === null) {
    return <div className="flex items-center justify-center min-h-[80vh] text-muted-foreground text-sm">Loading...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <Card className="w-full max-w-md bg-card/50 backdrop-blur border-border/50 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
              {showTotpSetup ? <QrCode className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              {showTotpSetup ? "Setup Authenticator" : "Restricted Area"}
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-2">
              {showTotpSetup
                ? "Scan the QR code with Google Authenticator to enable TOTP access."
                : "Enter the 6-digit code from your authenticator app."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {showTotpSetup ? (
              <TotpSetupCard onEnabled={() => { setShowTotpSetup(false); toast({ title: "TOTP configured", description: "Use your authenticator app to log in." }); }} />
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp} disabled={verifyOtpMutation.isPending}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} className="w-12 h-14 text-xl border-border bg-background" />
                      <InputOTPSlot index={1} className="w-12 h-14 text-xl border-border bg-background" />
                      <InputOTPSlot index={2} className="w-12 h-14 text-xl border-border bg-background" />
                      <InputOTPSlot index={3} className="w-12 h-14 text-xl border-border bg-background" />
                      <InputOTPSlot index={4} className="w-12 h-14 text-xl border-border bg-background" />
                      <InputOTPSlot index={5} className="w-12 h-14 text-xl border-border bg-background" />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button type="submit" className="w-full font-bold tracking-wider" disabled={verifyOtpMutation.isPending || otp.length < 6}>
                  {verifyOtpMutation.isPending ? "VERIFYING..." : "AUTHORIZE ACCESS"} <KeyRound className="w-4 h-4 ml-2" />
                </Button>
                <div className="text-center">
                  <button type="button" onClick={() => setShowTotpSetup(true)} className="text-xs text-muted-foreground hover:text-primary transition-colors underline underline-offset-2">
                    First time? Set up Google Authenticator
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-center py-20 text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center space-x-2">
            <Unlock className="w-5 h-5 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">System Configuration</h1>
          </div>
          <p className="text-muted-foreground mt-1">Core integration parameters and automation schedules.</p>
        </div>
        <Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting} className="font-bold tracking-wider">
          <Save className="w-4 h-4 mr-2" />
          {form.formState.isSubmitting ? "SAVING..." : "SAVE CHANGES"}
        </Button>
      </div>

      <Form {...form}>
        <form className="space-y-8">

          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center">
                <Server className="w-5 h-5 mr-2 text-primary" />
                Grafana Integration
              </CardTitle>
              <CardDescription>Data source for client SMS balances.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="grafanaUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>API URL</FormLabel>
                    <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="grafanaDashboardUid" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dashboard UID</FormLabel>
                    <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="grafanaApiKey" render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key (Bearer Token)</FormLabel>
                  <FormControl><Input type="password" className="bg-background font-mono text-sm" {...field} value={field.value || ""} placeholder="••••••••••••••••" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="googleSheetUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contacts Google Sheet URL</FormLabel>
                  <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} placeholder="https://docs.google.com/spreadsheets/d/..." /></FormControl>
                  <FormDescription>Public Google Sheet with client contacts. Must be shared with "Anyone with the link can view".</FormDescription>
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center">
                <Table2 className="w-5 h-5 mr-2 text-primary" />
                Sheet Column Routing
              </CardTitle>
              <CardDescription>
                Choose which Google Sheet columns feed each channel per severity. Enter column letter(s) separated by commas — e.g. <code className="text-xs bg-secondary px-1 rounded">F,H</code>.
                Multiple phone numbers or emails in one cell should also be comma-separated.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Warning */}
              <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/5 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-yellow-500">⚠ Warning</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField control={form.control} name="warningSmsCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Send SMS to (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="F,H" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="warningEmailToCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Email To (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="G,I" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="warningEmailCcCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Email CC (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="K" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>
              {/* Critical */}
              <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-red-400">🔴 Critical</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField control={form.control} name="criticalSmsCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Send SMS to (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="F,H,J" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="criticalEmailToCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Email To (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="K" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="criticalEmailCcCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Email CC (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="G,I,M" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>
              {/* Emergency */}
              <div className="rounded-lg border border-red-900/40 bg-red-900/10 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-red-300">🚨 Emergency</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField control={form.control} name="emergencySmsCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Send SMS to (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="F,H,J,L" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="emergencyEmailToCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Email To (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="M" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="emergencyEmailCcCols" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground">Email CC (cols)</FormLabel>
                      <FormControl><Input className="bg-background font-mono text-sm" placeholder="G,I,K" {...field} value={field.value || ""} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Default sheet layout: <span className="font-mono">F</span>=AM Mobile · <span className="font-mono">G</span>=AM Email · <span className="font-mono">H</span>=CSS Mobile · <span className="font-mono">I</span>=CSS Email · <span className="font-mono">J</span>=Manager Mobile · <span className="font-mono">K</span>=Manager Email · <span className="font-mono">L</span>=MD Mobile · <span className="font-mono">M</span>=MD Email
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <Clock className="w-5 h-5 mr-2 text-primary" />
                    Automation Schedule & Thresholds
                  </CardTitle>
                  <CardDescription>Configure when and how alerts are escalated.</CardDescription>
                </div>
                <FormField control={form.control} name="scheduleEnabled" render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormLabel className="m-0">Enable Auto-Runs</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField control={form.control} name="scheduleHour" render={({ field }) => (
                <FormItem>
                  <FormLabel>Daily Run Time (Hour 0–23)</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} max={23} className="bg-background w-32 font-mono" {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                  </FormControl>
                  <FormDescription>The hour of the day to execute the automated check.</FormDescription>
                </FormItem>
              )} />
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-medium text-foreground">Escalation Thresholds (Days Remaining)</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FormField control={form.control} name="thresholdStaff" render={({ field }) => (
                    <FormItem className="bg-secondary/30 p-4 rounded-md border border-border/50">
                      <FormLabel className="text-yellow-500 font-bold tracking-wider uppercase text-xs">Warning (Staff)</FormLabel>
                      <FormControl>
                        <Input type="number" className="bg-background font-mono mt-2" {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="thresholdManager" render={({ field }) => (
                    <FormItem className="bg-secondary/30 p-4 rounded-md border border-border/50">
                      <FormLabel className="text-red-500 font-bold tracking-wider uppercase text-xs">Critical (Manager)</FormLabel>
                      <FormControl>
                        <Input type="number" className="bg-background font-mono mt-2" {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="thresholdMd" render={({ field }) => (
                    <FormItem className="bg-secondary/30 p-4 rounded-md border border-red-900/40">
                      <FormLabel className="text-red-400 font-bold tracking-wider uppercase text-xs">Emergency (MD)</FormLabel>
                      <FormControl>
                        <Input type="number" className="bg-background font-mono mt-2" {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <MessageSquare className="w-5 h-5 mr-2 text-primary" />
                    SMS Channel
                  </CardTitle>
                  <CardDescription>Primary notification channel for critical alerts.</CardDescription>
                </div>
                <FormField control={form.control} name="smsEnabled" render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="smsApiUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider Endpoint URL</FormLabel>
                  <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} placeholder="https://sms.example.com/send" /></FormControl>
                  <FormDescription>The POST endpoint of your SMS provider API.</FormDescription>
                </FormItem>
              )} />
              <FormField control={form.control} name="smsBodyTemplate" render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Request Body Template
                    <div className="flex gap-1">
                      {["{phone}", "{message}"].map(p => (
                        <Badge key={p} variant="secondary" className="font-mono text-xs cursor-pointer select-all" onClick={() => {
                          const ta = document.getElementById("sms-body-textarea") as HTMLTextAreaElement | null;
                          if (ta) {
                            const start = ta.selectionStart;
                            const end = ta.selectionEnd;
                            const val = ta.value;
                            const next = val.slice(0, start) + p + val.slice(end);
                            field.onChange(next);
                            setTimeout(() => { ta.setSelectionRange(start + p.length, start + p.length); ta.focus(); }, 0);
                          } else {
                            field.onChange((field.value || "") + p);
                          }
                        }}>{p}</Badge>
                      ))}
                    </div>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      id="sms-body-textarea"
                      className="bg-background font-mono text-sm min-h-[120px] resize-y"
                      {...field}
                      value={field.value || ""}
                      placeholder={`{\n  "to": "{phone}",\n  "text": "{message}",\n  "api_key": "YOUR_KEY_HERE"\n}`}
                    />
                  </FormControl>
                  <FormDescription>
                    JSON body sent to the endpoint. Use <code className="text-xs bg-secondary px-1 rounded">{"{phone}"}</code> for the recipient number and <code className="text-xs bg-secondary px-1 rounded">{"{message}"}</code> for the alert text. Click placeholders above to insert.
                  </FormDescription>
                </FormItem>
              )} />
              <Separator className="my-2 border-border/40" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Send Test SMS</p>
                <p className="text-xs text-muted-foreground">Sends a test message using the current saved SMS settings. If it fails, the error toast shows exactly what was sent and what the API replied.</p>
                <div className="flex gap-2">
                  <Input
                    type="tel"
                    placeholder="+966500000000"
                    value={testSmsTo}
                    onChange={e => setTestSmsTo(e.target.value)}
                    className="bg-background font-mono text-sm flex-1"
                    onKeyDown={e => e.key === "Enter" && handleTestSms()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestSms}
                    disabled={testSmsSending}
                    className="shrink-0"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {testSmsSending ? "Sending…" : "Send Test"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <Mail className="w-5 h-5 mr-2 text-primary" />
                    SMTP Channel
                  </CardTitle>
                  <CardDescription>Email fallback and rich reporting channel.</CardDescription>
                </div>
                <FormField control={form.control} name="smtpEnabled" render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="smtpHost" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>SMTP Host</FormLabel>
                    <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="smtpPort" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl><Input type="number" className="bg-background font-mono text-sm" {...field} value={field.value || ""} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="smtpTls" render={({ field }) => (
                <FormItem className="flex items-center gap-3 rounded-md border border-border/50 bg-background/40 px-4 py-3">
                  <FormControl>
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="cursor-pointer">Enable TLS / SSL</FormLabel>
                    <FormDescription className="text-xs">Turn on for port 465 (SMTPS). Leave off for port 587 STARTTLS or plain SMTP.</FormDescription>
                  </div>
                </FormItem>
              )} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="smtpUser" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="smtpPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" className="bg-background font-mono text-sm" {...field} value={field.value || ""} placeholder="••••••••" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="smtpFrom" render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Address</FormLabel>
                    <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} placeholder="alerts@example.com" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <Separator className="my-2 border-border/40" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Send Test Email</p>
                <p className="text-xs text-muted-foreground">Sends a test message using the current saved SMTP settings to verify your configuration.</p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="recipient@example.com"
                    value={testEmailTo}
                    onChange={e => setTestEmailTo(e.target.value)}
                    className="bg-background font-mono text-sm flex-1"
                    onKeyDown={e => e.key === "Enter" && handleTestEmail()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestEmail}
                    disabled={testEmailSending}
                    className="shrink-0"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {testEmailSending ? "Sending…" : "Send Test"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <Send className="w-5 h-5 mr-2 text-primary" />
                    Telegram Channel
                  </CardTitle>
                  <CardDescription>Instant messaging for group notifications.</CardDescription>
                </div>
                <FormField control={form.control} name="telegramEnabled" render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="telegramBotToken" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bot Token</FormLabel>
                    <FormControl><Input type="password" className="bg-background font-mono text-sm" {...field} value={field.value || ""} placeholder="••••••••••••••••••••••••••••••••••••" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="telegramChatId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chat ID</FormLabel>
                    <FormControl><Input className="bg-background font-mono text-sm" {...field} value={field.value || ""} /></FormControl>
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          <TelegramBotCard />

          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center">
                <ShieldCheck className="w-5 h-5 mr-2 text-primary" />
                Authenticator Setup
              </CardTitle>
              <CardDescription>
                {settings?.totpEnabled
                  ? "TOTP is active. Re-scan the QR code if you need to reconfigure your authenticator app."
                  : "TOTP is not yet enabled. Scan the QR code to activate Google Authenticator."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TotpSetupCard onEnabled={() => queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() })} />
            </CardContent>
          </Card>

        </form>
      </Form>
    </div>
  );
}
