import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, ShieldCheck, KeyRound } from "lucide-react";

type Step = "password" | "totp_setup" | "totp_verify";

interface LoginPageProps {
  onSuccess: () => void;
  initialStep: "totp_setup" | "totp_verify" | null;
}

export default function LoginPage({ onSuccess, initialStep }: LoginPageProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(
    initialStep === "totp_setup" ? "totp_setup"
    : initialStep === "totp_verify" ? "totp_verify"
    : "password",
  );
  const [isLoading, setIsLoading] = useState(false);

  // Step 1 state
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const api = async (url: string, body: object) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as Record<string, unknown>;
    if (!r.ok) throw new Error((data["error"] as string) ?? "Request failed");
    return data;
  };

  // ── Step 1: password ─────────────────────────────────────────────────────────
  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) return;
    setIsLoading(true);
    try {
      const data = await api("/api/auth/login", { identifier, password });
      if (data["ok"] === true) {
        onSuccess();
      } else if (data["step"] === "totp_setup") {
        setQrDataUrl((data["qrDataUrl"] as string) ?? null);
        setManualKey((data["manualKey"] as string) ?? null);
        setStep("totp_setup");
      } else {
        setStep("totp_verify");
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Login failed", description: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Back to password step ─────────────────────────────────────────────────────
  const handleBack = async () => {
    // Clear server-side pending session
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setStep("password");
    setTotpCode("");
    setQrDataUrl(null);
    setManualKey(null);
  };

  // ── Step 2a: TOTP setup confirmation ─────────────────────────────────────────
  const handleTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) return;
    setIsLoading(true);
    try {
      await api("/api/auth/totp/confirm-setup", { code: totpCode });
      onSuccess();
    } catch (err) {
      toast({ variant: "destructive", title: "Invalid code", description: (err as Error).message });
      setTotpCode("");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 2b: TOTP verify ─────────────────────────────────────────────────────
  const handleTotpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) return;
    setIsLoading(true);
    try {
      await api("/api/auth/totp/verify", { code: totpCode });
      onSuccess();
    } catch (err) {
      toast({ variant: "destructive", title: "Access denied", description: (err as Error).message });
      setTotpCode("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-xs">BA</span>
          </div>
          <span className="text-xl font-bold tracking-tight">
            <span className="text-foreground">BALANCE</span>
            <span className="text-primary">ALERT</span>
          </span>
        </div>

        {/* ── Step 1: Username + Password ── */}
        {step === "password" && (
          <Card className="bg-card/50 backdrop-blur border-border/60">
            <CardHeader className="text-center pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Lock className="w-7 h-7 text-primary" />
                </div>
              </div>
              <CardTitle className="text-xl">Sign In</CardTitle>
              <CardDescription>Enter your credentials to continue.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="identifier">Username or Email</Label>
                  <Input
                    id="identifier"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                    disabled={isLoading}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={isLoading}
                    required
                  />
                </div>
                <Button className="w-full" disabled={isLoading || !identifier || !password}>
                  {isLoading
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>
                    : <><Lock className="mr-2 h-4 w-4" /> Sign In</>}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2a: TOTP Setup ── */}
        {step === "totp_setup" && (
          <Card className="bg-card/50 backdrop-blur border-border/60">
            <CardHeader className="text-center pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <ShieldCheck className="w-7 h-7 text-primary" />
                </div>
              </div>
              <CardTitle className="text-xl">Set Up Two-Factor Auth</CardTitle>
              <CardDescription>
                Scan the QR code with Google Authenticator, Authy, or 1Password, then enter
                the 6-digit code to confirm.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleTotpSetup} className="space-y-4">
                {qrDataUrl && (
                  <div className="flex justify-center">
                    <img src={qrDataUrl} alt="TOTP QR code" className="w-48 h-48 rounded-md border border-border/60 bg-white p-2" />
                  </div>
                )}
                {manualKey && (
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                    <p className="text-[11px] text-muted-foreground mb-1">Manual entry key</p>
                    <code className="text-xs font-mono tracking-wider break-all">{manualKey}</code>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="totp-setup">6-Digit Code</Label>
                  <Input
                    id="totp-setup"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    className="text-center font-mono text-lg tracking-[0.4em]"
                    autoComplete="one-time-code"
                    disabled={isLoading}
                  />
                </div>
                <Button className="w-full" disabled={isLoading || totpCode.length !== 6}>
                  {isLoading
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming…</>
                    : <><ShieldCheck className="mr-2 h-4 w-4" /> Confirm &amp; Activate</>}
                </Button>
                <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={handleBack} disabled={isLoading}>
                  ← Back to Login
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2b: TOTP Verify ── */}
        {step === "totp_verify" && (
          <Card className="bg-card/50 backdrop-blur border-border/60">
            <CardHeader className="text-center pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <KeyRound className="w-7 h-7 text-primary" />
                </div>
              </div>
              <CardTitle className="text-xl">Two-Factor Verification</CardTitle>
              <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleTotpVerify} className="space-y-4">
                <Input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  className="text-center font-mono text-2xl tracking-[0.5em] h-14"
                  autoComplete="one-time-code"
                  autoFocus
                  disabled={isLoading}
                />
                <Button className="w-full" disabled={isLoading || totpCode.length !== 6}>
                  {isLoading
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</>
                    : <><KeyRound className="mr-2 h-4 w-4" /> Authorize Access</>}
                </Button>
                <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={handleBack} disabled={isLoading}>
                  ← Back to Login
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Lost your authenticator?{" "}
                  <span className="text-primary">Contact your administrator to reset TOTP.</span>
                </p>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
