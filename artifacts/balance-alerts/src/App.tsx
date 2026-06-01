import { createContext, useContext } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Contacts from "@/pages/contacts";
import History from "@/pages/history";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        if (error instanceof Error && error.message.includes("401")) return false;
        return failureCount < 1;
      },
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  },
});

// ─── Auth context ──────────────────────────────────────────────────────────────
interface AuthState {
  authenticated: boolean;
  requiresAuth: boolean;
  isLoading: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthState>({
  authenticated: false,
  requiresAuth: false,
  isLoading: true,
  refetch: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const AUTH_CHECK_KEY = ["auth", "check"];

function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: AUTH_CHECK_KEY,
    queryFn: async () => {
      const resp = await fetch("/api/auth/check", { credentials: "include" });
      if (!resp.ok) throw new Error("Auth check failed");
      return resp.json() as Promise<{ authenticated: boolean; requiresAuth: boolean }>;
    },
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const authState: AuthState = {
    authenticated: data?.authenticated ?? false,
    requiresAuth: data?.requiresAuth ?? false,
    isLoading,
    refetch: () => {
      qc.invalidateQueries({ queryKey: AUTH_CHECK_KEY });
    },
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (data?.requiresAuth && !data?.authenticated) {
    return (
      <AuthContext.Provider value={authState}>
        <LoginPage onSuccess={() => qc.invalidateQueries({ queryKey: AUTH_CHECK_KEY })} />
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>;
}

// ─── Router ────────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/history" component={History} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AppLayout>
              <Router />
            </AppLayout>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
