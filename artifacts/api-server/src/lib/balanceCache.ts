export interface CachedBalance {
  metric: string;
  remainingBalance: number;
  daysRemaining: number;
  severity: string;
}

let _cache: CachedBalance[] = [];
let _lastUpdated: Date | null = null;

export function updateBalanceCache(entries: CachedBalance[]): void {
  _cache = entries;
  _lastUpdated = new Date();
}

export function getBalanceCache(): { entries: CachedBalance[]; lastUpdated: Date | null } {
  return { entries: _cache, lastUpdated: _lastUpdated };
}
