import { Activity, Bell, Bot, Cpu, HeartPulse, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HealthRing, KIND_LABEL, Kpi, LEVEL_TEXT, SeverityBadge, Sparkline, StatusDot, timeAgo } from "../components/ui";
import { api } from "../lib/client";
import { useLive, useLiveRefresh } from "../lib/live";
import type { Alert, DeviceSummary, FleetSummary } from "../lib/types";

const HISTORY = 40;

export default function Overview() {
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [spark, setSpark] = useState<Record<string, number[]>>({});

  const load = useCallback(() => {
    api.fleet().then(setSummary);
    api.devices().then(setDevices);
    api.alerts("active").then((a) => setAlerts(a.slice(0, 12)));
  }, []);
  useEffect(() => {
    load();
    // seed sparklines with recent history of the primary metric of each device
    api.devices().then((ds) => ds.forEach((d) => {
      const key = Object.keys(d.latest)[0];
      if (key) api.telemetry(d.id, 15).then((t) => setSpark((s) => ({ ...s, [d.id]: (t.series[key] ?? []).slice(-HISTORY).map((p) => p.value) })));
    }));
  }, [load]);
  useLiveRefresh(load, 2500);
  useLive((e) => {
    if (e.type !== "telemetry") return;
    const key = Object.keys(e.values)[0];
    setSpark((s) => ({ ...s, [e.device_id]: [...(s[e.device_id] ?? []), e.values[key]].slice(-HISTORY) }));
  });

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Fleet overview</h1>
          <p className="text-sm text-slate-400">Live telemetry, anomaly detection and predictive maintenance across your devices.</p>
        </div>
        <Link to="/assistant" className="btn-primary"><Sparkles className="h-4 w-4" /> Ask EdgePulse AI</Link>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<Cpu className="h-5 w-5" />} label="Devices online" value={`${summary.online}/${summary.devices}`} sub="MQTT + HTTP ingestion" />
          <Kpi icon={<Bell className="h-5 w-5" />} label="Active alerts" value={summary.open_alerts} sub={`${summary.critical_alerts} critical`} tone={summary.critical_alerts ? "text-rose-400" : "text-white"} />
          <Kpi icon={<HeartPulse className="h-5 w-5" />} label="Fleet health" value={`${summary.avg_health}%`} tone={summary.avg_health >= 80 ? "text-emerald-300" : summary.avg_health >= 50 ? "text-amber-300" : "text-rose-400"} sub="Weighted by open alerts" />
          <Kpi icon={<Activity className="h-5 w-5" />} label="Readings / min" value={summary.readings_per_minute} sub="Across all metrics" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="grid content-start gap-4 md:grid-cols-2 xl:col-span-2">
          {devices.map((d) => {
            const primary = Object.values(d.latest);
            return (
              <Link key={d.id} to={`/devices/${d.id}`} className="card group p-5 transition hover:border-brand-500/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><StatusDot online={d.status === "online"} /><span className="truncate font-semibold text-white">{d.name}</span></div>
                    <div className="mt-0.5 text-xs text-slate-500">{d.type_label} · {d.location}</div>
                  </div>
                  <HealthRing value={d.health} size={48} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {primary.map((l) => (
                    <div key={l.label} className="rounded-lg bg-ink-950/50 px-2.5 py-2">
                      <div className="truncate text-[10px] uppercase tracking-wider text-slate-500">{l.label}</div>
                      <div className={`text-sm font-semibold ${LEVEL_TEXT[l.level]}`}>{l.value}<span className="ml-0.5 text-[11px] font-normal text-slate-500">{l.unit}</span></div>
                    </div>
                  ))}
                </div>
                <div className="mt-3"><Sparkline data={spark[d.id] ?? []} color={d.critical_alerts ? "#f43f5e" : d.open_alerts ? "#fbbf24" : "#22d3ee"} /></div>
                <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                  <span>{d.open_alerts ? `${d.open_alerts} open alert${d.open_alerts > 1 ? "s" : ""}` : "No issues"}</span>
                  <span>updated {timeAgo(d.last_seen)}</span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-white">Live alerts</h2>
            <Link to="/alerts" className="text-xs text-brand-300 hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {alerts.length === 0 && <p className="text-sm text-slate-500">All clear.</p>}
            {alerts.map((a) => (
              <Link key={a.id} to={`/devices/${a.device_id}`} className="block rounded-xl border border-white/[0.06] bg-ink-950/40 p-3 hover:border-white/15">
                <div className="flex items-center gap-2 text-xs">
                  <SeverityBadge severity={a.severity} />
                  <span className="chip border-white/10 bg-white/5 text-slate-300">{KIND_LABEL[a.kind]}</span>
                  <span className="ml-auto font-mono text-slate-500">{a.device_id}</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-snug text-slate-300">{a.message}</p>
              </Link>
            ))}
          </div>
          <Link to="/assistant" className="mt-4 flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/[0.07] p-3 text-sm text-brand-200 hover:bg-brand-500/10">
            <Bot className="h-4 w-4" /> Ask the AI to diagnose these alerts
          </Link>
        </div>
      </div>
    </div>
  );
}
