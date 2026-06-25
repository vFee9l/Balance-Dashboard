import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, History, Settings, Zap, LogOut,
  Bot, UserCog, ClipboardList,
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

export function Sidebar() {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { role, username } = useAuth();
  const pendingBotCount = usePendingBotCount();
  const isAdmin = role === "admin";

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard, badge: 0, adminOnly: false },
    { name: "Contacts", href: "/contacts", icon: Users, badge: 0, adminOnly: false },
    { name: "History", href: "/history", icon: History, badge: 0, adminOnly: false },
    { name: "Bot Users", href: "/bot-users", icon: Bot, badge: pendingBotCount, adminOnly: true },
    { name: "Settings", href: "/settings", icon: Settings, badge: 0, adminOnly: true },
    { name: "Users", href: "/users", icon: UserCog, badge: 0, adminOnly: true },
    { name: "Login Audit", href: "/audit/login", icon: ClipboardList, badge: 0, adminOnly: true },
  ].filter((item) => !item.adminOnly || isAdmin);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["auth", "check"] });
  };

  return (
    <div className="w-64 flex-shrink-0 border-r border-border bg-card h-screen flex flex-col fixed left-0 top-0">
      <div className="h-16 flex items-center px-6 border-b border-border bg-background">
        <Zap className="w-5 h-5 text-primary mr-2" />
        <span className="font-bold text-lg tracking-tight uppercase">
          Balance<span className="text-primary">Alert</span>
        </span>
      </div>
      <div className="p-4 flex-1 overflow-y-auto">
        <nav className="space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={cn(
                    "flex items-center px-3 py-2.5 text-sm font-medium rounded-md cursor-pointer transition-colors group",
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent",
                  )}
                >
                  <item.icon
                    className={cn(
                      "mr-3 flex-shrink-0 h-4 w-4",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{item.name}</span>
                  {item.badge > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                      {item.badge}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-border space-y-2">
        {username && (
          <p className="text-xs text-muted-foreground truncate px-3">
            Signed in as <span className="font-medium text-foreground">{username}</span>
            {role === "admin" && (
              <span className="ml-1.5 text-[10px] font-semibold text-primary uppercase tracking-wider">Admin</span>
            )}
          </p>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center w-full px-3 py-2.5 text-sm font-medium rounded-md cursor-pointer transition-colors text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent group"
        >
          <LogOut className="mr-3 flex-shrink-0 h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          Log Out
        </button>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth();
  if (!authenticated) {
    return <>{children}</>;
  }
  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
