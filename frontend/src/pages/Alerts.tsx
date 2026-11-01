import { Bell, Check, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KIND_LABEL, SeverityBadge, timeAgo } from "../components/ui";
import { api } from "../lib/client";
import { useLiveRefresh } from "../lib/live";
import type { Alert } from "../lib/types";

const FILTERS = [["active", "Active"], ["open", "Open"], ["acknowledged", "Acknowledged"], ["resolved", "Resolved"]] as const;

export default function Alerts() {
  const [filter, setFilter] = useState<string>("active");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const load = useCallback(() => { api.alerts(filter).then(setAlerts); }, [filter]);
  useEffect(load, [load]);
  useLiveRefresh(load, 2000);

  async function act(id: number, action: "ack" | "resolve") { await api.setAlertStatus(id, action); load(); }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-300"><Bell /></div>
          <div><h1 className="text-xl font-semibold text-white">Alerts</h1><p className="text-sm text-slate-400">Limit breaches, statistical anomalies, trend forecasts and connectivity loss.</p></div>
        </div>
        <div className="flex rounded-xl bg-ink-900 p-1 text-sm">
          {FILTERS.map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-lg px-3 py-1.5 ${filter === key ? "bg-brand-500 text-ink-950" : "text-slate-400 hover:text-white"}`}>{label}</button>)}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-slate-500">
            <tr><th className="px-5 py-3">Severity</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Device</th><th className="px-3 py-3">Details</th><th className="px-3 py-3">Updated</th><th className="px-5 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {alerts.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No alerts in this view.</td></tr>}
            {alerts.map((a) => (
              <tr key={a.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                <td className="px-5 py-3"><SeverityBadge severity={a.severity} /></td>
                <td className="px-3 py-3 text-slate-300">{KIND_LABEL[a.kind]}</td>
                <td className="px-3 py-3"><Link to={`/devices/${a.device_id}`} className="font-mono text-brand-300 hover:underline">{a.device_id}</Link></td>
                <td className="max-w-md px-3 py-3 text-slate-300">{a.message}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{timeAgo(a.updated_at)}</td>
                <td className="px-5 py-3 text-right">
                  {a.status === "open" && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => act(a.id, "ack")}><Check className="h-3.5 w-3.5" /> Ack</button>}
                  {a.status !== "resolved" && <button className="btn-ghost ml-2 px-2.5 py-1 text-xs" onClick={() => act(a.id, "resolve")}><CheckCheck className="h-3.5 w-3.5" /> Resolve</button>}
                  {a.status === "resolved" && <span className="text-xs text-emerald-300">resolved</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
