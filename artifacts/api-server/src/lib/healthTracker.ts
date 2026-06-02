/**
 * In-process health tracker — records the outcome of every Grafana fetch
 * so the Nagios health endpoint can report datasource status without
 * triggering a live fetch on every poll.
 */

interface GrafanaFetchState {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalAttempts: number;
}

const state: GrafanaFetchState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  totalAttempts: 0,
};

export function recordGrafanaFetch(success: boolean, error?: string): void {
  state.lastAttemptAt = new Date();
  state.totalAttempts++;
  if (success) {
    state.lastSuccessAt = new Date();
    state.lastError = null;
    state.consecutiveFailures = 0;
  } else {
    state.lastError = error ?? "unknown error";
    state.consecutiveFailures++;
  }
}

export function getGrafanaHealth(): GrafanaFetchState & { staleMinutes: number | null } {
  const staleMinutes =
    state.lastAttemptAt
      ? Math.floor((Date.now() - state.lastAttemptAt.getTime()) / 60000)
      : null;
  return { ...state, staleMinutes };
}
