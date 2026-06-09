export function SourceBadgeVariants() {
  const rows = [
    { metric: "ARAMCO", balance: "39.4 M", daily: "1.2 M/d", change: "↑ 3.2%", days: "32", severity: "ok", direct: false },
    { metric: "Barq", balance: "1,340.5 M", daily: "44.3 M/d", change: "↓ 1.1%", days: "30", severity: "ok", direct: false },
    { metric: "AlRajhi", balance: "205.3 K", daily: "8.2 K/d", change: "↑ 0.4%", days: "25", severity: "ok", direct: false },
    { metric: "AlRajhi-1", balance: "1,887.9 M", daily: "—", change: "—", days: "—", severity: "ok", direct: true },
    { metric: "AlRajhi-2", balance: "1,954.7 M", daily: "—", change: "—", days: "—", severity: "ok", direct: true },
    { metric: "AlRajhi-3", balance: "476.3 M", daily: "—", change: "—", days: "—", severity: "ok", direct: true },
    { metric: "ANB", balance: "18.4 K", daily: "1.5 K/d", change: "↓ 8.1%", days: "12", severity: "warning", direct: false },
    { metric: "Enjaz", balance: "6.7 M", daily: "580 K/d", change: "↑ 2.3%", days: "11", severity: "warning", direct: false },
    { metric: "SNB-Board", balance: "8.7 K", daily: "3.1 K/d", change: "↑ 14.2%", days: "2", severity: "emergency", direct: false },
  ];

  const severityColors: Record<string, string> = {
    ok: "text-emerald-400 bg-emerald-400/10",
    warning: "text-amber-400 bg-amber-400/10",
    critical: "text-orange-400 bg-orange-400/10",
    emergency: "text-red-400 bg-red-400/10",
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200 p-6 font-sans">
      <div className="max-w-5xl mx-auto space-y-10">

        {/* Variant A — Inline pill badge */}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Variant A</span>
            <span className="text-sm text-slate-400">Inline "Org" pill on the org name</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#161b27] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {["Client", "Balance", "Avg/Day", "Daily Δ", "Est. Days", "Status"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-mono text-[11px] font-semibold tracking-wider uppercase text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.metric + "a"} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium">
                      <span className="flex items-center gap-2">
                        {row.metric}
                        {row.direct && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                            ORG
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-right">{row.balance}</td>
                    <td className="px-4 py-3 font-mono text-right text-slate-400">{row.daily}</td>
                    <td className="px-4 py-3 font-mono text-right text-slate-400">{row.change}</td>
                    <td className="px-4 py-3 font-mono text-right font-bold text-base">
                      {row.days === "—"
                        ? <span className="text-slate-500 text-sm font-normal">—</span>
                        : row.days}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${severityColors[row.severity]}`}>
                        {row.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 mr-1">ORG</span>
            = balance read directly from Organisation record (no history data — Est. Days shows — )
          </p>
        </div>

        {/* Variant B — Row-level left accent + tooltip */}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Variant B</span>
            <span className="text-sm text-slate-400">Subtle left border accent on "direct" rows</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#161b27] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {["Client", "Balance", "Avg/Day", "Daily Δ", "Est. Days", "Status"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-mono text-[11px] font-semibold tracking-wider uppercase text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.metric + "b"}
                    className={`border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors ${row.direct ? "border-l-2 border-l-violet-500/50" : "border-l-2 border-l-transparent"}`}
                  >
                    <td className="px-4 py-3 font-mono font-medium">
                      <span className="flex items-center gap-1.5">
                        {row.metric}
                        {row.direct && (
                          <span title="Balance read directly from Organisation record — no hourly history available" className="cursor-default text-violet-400/70 hover:text-violet-400 transition-colors">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                            </svg>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-right">{row.balance}</td>
                    <td className="px-4 py-3 font-mono text-right text-slate-400">{row.daily}</td>
                    <td className="px-4 py-3 font-mono text-right text-slate-400">{row.change}</td>
                    <td className="px-4 py-3 font-mono text-right font-bold text-base">
                      {row.days === "—"
                        ? <span className="text-slate-500 text-sm font-normal">—</span>
                        : row.days}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${severityColors[row.severity]}`}>
                        {row.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Violet left border + ⓘ icon on hover tooltip — no visual noise on normal rows
          </p>
        </div>

      </div>
    </div>
  );
}
