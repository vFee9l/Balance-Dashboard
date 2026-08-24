import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, History, Settings, Zap, LogOut,
  Bot, UserCog, ClipboardList, Activity, Menu, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/App";

function usePendingBotCount() {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["telegram", "pending-count"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/users/pending/count", { credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json() as Promise<{ count: number }>;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
  return data?.count ?? 0;
}

function getNavigationItems(isAdmin: boolean, pendingBotCount: number) {
  return [
    { name: "Dashboard", href: "/", icon: LayoutDashboard, badge: 0, adminOnly: false },
    { name: "Contacts", href: "/contacts", icon: Users, badge: 0, adminOnly: true },
    { name: "History", href: "/history", icon: History, badge: 0, adminOnly: true },
    { name: "Bot Users", href: "/bot-users", icon: Bot, badge: pendingBotCount, adminOnly: true },
    { name: "Settings", href: "/settings", icon: Settings, badge: 0, adminOnly: true },
    { name: "Users", href: "/users", icon: UserCog, badge: 0, adminOnly: true },
    { name: "Login Audit", href: "/audit/login", icon: ClipboardList, badge: 0, adminOnly: true },
  ].filter((item) => !item.adminOnly || isAdmin);
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.15)]">
        <Activity className="w-4 h-4 text-primary" />
      </div>
      <span className="font-bold text-[15px] tracking-tight text-sidebar-foreground">
        BALANCE<span className="text-primary">ALERT</span>
      </span>
    </div>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { role, username } = useAuth();
  const pendingBotCount = usePendingBotCount();
  const isAdmin = role === "admin";

  const navigation = getNavigationItems(isAdmin, pendingBotCount);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["auth", "check"] });
  };

  return (
    <div className="hidden lg:flex w-[260px] flex-shrink-0 border-r border-sidebar-border bg-sidebar h-screen flex-col fixed left-0 top-0 z-40">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border bg-sidebar/95 backdrop-blur-sm">
        <BrandMark />
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-4">
        <div className="mb-4 px-2 text-[10px] font-bold tracking-widest text-sidebar-foreground/40 uppercase">
          Navigation
        </div>
        <nav className="space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href} data-testid={`nav-link-${item.name.toLowerCase().replace(/\s+/g, '-')}`}>
                <div
                  className={cn(
                    "flex items-center px-3 py-2.5 text-sm font-medium rounded-md cursor-pointer transition-all duration-200 group relative overflow-hidden",
                    isActive
                      ? "text-primary bg-primary/5"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)]" />
                  )}
                  <item.icon
                    className={cn(
                      "mr-3 flex-shrink-0 h-[18px] w-[18px] transition-colors duration-200",
                      isActive ? "text-primary" : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/80",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1 tracking-wide">{item.name}</span>
                  {item.badge > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-[0_0_10px_rgba(var(--color-amber-500),0.1)]">
                      {item.badge}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-sidebar-border bg-sidebar/50 backdrop-blur-sm">
        {username && (
          <div className="mb-4 px-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
              <p className="text-[11px] font-semibold text-sidebar-foreground/50 tracking-wider uppercase">Active Session</p>
            </div>
            <p className="text-sm font-mono text-sidebar-foreground/90 truncate flex items-center gap-2">
              {username}
              {role === "admin" && (
                <span className="text-[9px] font-bold text-primary/90 uppercase tracking-widest bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                  ADM
                </span>
              )}
            </p>
          </div>
        )}
        <button
          onClick={handleLogout}
          data-testid="button-logout"
          className="flex items-center w-full px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-all text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive group border border-transparent hover:border-destructive/20"
        >
          <LogOut className="mr-3 flex-shrink-0 h-[18px] w-[18px] text-sidebar-foreground/40 group-hover:text-destructive" />
          Disconnect
        </button>
      </div>
    </div>
  );
}

function MobileNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();
  const qc = useQueryClient();
  const { role, username } = useAuth();
  const pendingBotCount = usePendingBotCount();
  const navigation = getNavigationItems(role === "admin", pendingBotCount);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["auth", "check"] });
  };

  return (
    <div className="lg:hidden">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-4 backdrop-blur-md">
        <BrandMark />
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          data-testid="button-open-mobile-navigation"
          className="flex h-9 w-9 items-center justify-center rounded border border-border/70 text-sidebar-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
      </header>

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            data-testid="button-close-mobile-navigation"
            className="absolute inset-0 h-full w-full bg-black/70 backdrop-blur-sm"
            aria-label="Close navigation"
          />
          <aside className="relative flex h-full w-[min(86vw,320px)] flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
              <BrandMark />
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                data-testid="button-dismiss-mobile-navigation"
                className="flex h-8 w-8 items-center justify-center rounded text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-primary"
                aria-label="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-4">
              <p className="mb-3 px-2 text-[10px] font-bold tracking-widest text-sidebar-foreground/40 uppercase">Navigation</p>
              {navigation.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    data-testid={`mobile-nav-link-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <div className={cn(
                      "flex items-center rounded-md px-3 py-3 text-sm font-medium transition-colors",
                      isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}>
                      <item.icon className="mr-3 h-[18px] w-[18px]" />
                      <span className="flex-1">{item.name}</span>
                      {item.badge > 0 && (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-sidebar-border p-4">
              {username && <p className="mb-3 truncate font-mono text-xs text-sidebar-foreground/70">Signed in as {username}</p>}
              <button
                type="button"
                onClick={handleLogout}
                data-testid="button-mobile-logout"
                className="flex w-full items-center rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                <LogOut className="mr-3 h-4 w-4" />
                Disconnect
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth();
  if (!authenticated) {
    return <>{children}</>;
  }
  return (
    <div className="min-h-screen bg-background text-foreground scanlines">
      <Sidebar />
      <MobileNavigation />
      <main className="relative z-10 min-w-0 p-4 sm:p-6 lg:ml-[260px] lg:p-10">
        {/* Subtle grid background for the main content area to enhance the tech vibe */}
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

        <div className="relative mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
