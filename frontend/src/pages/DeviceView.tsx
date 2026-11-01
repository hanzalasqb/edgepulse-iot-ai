import { Clock, Power, RefreshCcw, ScanSearch, Timer, TrendingUp, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { HealthRing, KIND_LABEL, LEVEL_TEXT, SeverityBadge, Spinner, StatusDot, timeAgo, toDate } from "../components/ui";
import { api } from "../lib/client";
import { useLive, useLiveRefresh } from "../lib/live";
import type { Alert, Command, DeviceDetail, MetricSpec, Point, ScanResult } from "../lib/types";

const WINDOWS = [15, 60, 180];
const fmtTime = (iso: string) => toDate(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function MetricChart({ spec, points }: { spec: MetricSpec; points: Point[] }) {
  const data = points.map((p) => ({ t: fmtTime(p.ts), v: p.value, a: p.anomaly ? p.value : null }));
  const last = points.at(-1)?.value;
  // always show the warning limits so the operator sees the headroom
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, ...(spec.warn_low !== null ? [spec.warn_low] : []));
  const hi = Math.max(...values, ...(spec.warn_high !== null ? [spec.warn_high] : []));
  const pad = (hi - lo) * 0.08 || 1;
  const domain: [number, number] = values.length ? [+(lo - pad).toFixed(2), +(hi + pad).toFixed(2)] : [0, 1];
  return (
    <div className="card p-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-slate-300">{spec.label}</h3>
        <span className="text-xl font-semibold text-white">{last ?? "–"}<span className="ml-1 text-xs text-slate-500">{spec.unit}</span></span>
      </div>
      <div className="h-48">
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <CartesianGrid stroke="#1b2436" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={40} domain={domain} allowDataOverflow />
            <Tooltip contentStyle={{ background: "#0a0f1c", border: "1px solid #1f2a40", borderRadius: 12, fontSize: 12 }} formatter={(v) => [`${v} ${spec.unit}`, spec.label]} />
            {spec.warn_high !== null && <ReferenceLine y={spec.warn_high} stroke="#fbbf24" strokeDasharray="4 4" />}
            {spec.crit_high !== null && <ReferenceLine y={spec.crit_high} stroke="#f43f5e" strokeDasharray="4 4" />}
            {spec.warn_low !== null && <ReferenceLine y={spec.warn_low} stroke="#fbbf24" strokeDasharray="4 4" />}
            {spec.crit_low !== null && <ReferenceLine y={spec.crit_low} stroke="#f43f5e" strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="v" stroke="#22d3ee" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            <Scatter dataKey="a" fill="#f43f5e" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-amber-400" />warning</span>
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-rose-500" />critical</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />anomaly</span>
      </div>
    </div>
  );
}

export default function DeviceView() {
  const { id = "" } = useParams();
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [series, setSeries] = useState<Record<string, Point[]>>({});
  const [minutes, setMinutes] = useState(60);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadMeta = useCallback(() => {
    api.device(id).then(setDevice).catch(() => setDevice(null));
    api.alerts("active", id).then(setAlerts);
    api.commands(id).then(setCommands);
  }, [id]);
  useEffect(() => { setScan(null); loadMeta(); api.telemetry(id, minutes).then((t) => setSeries(t.series)); }, [id, minutes, loadMeta]);
  useLiveRefresh(loadMeta, 3000);
  useLive((e) => {
    if (e.type !== "telemetry" || e.device_id !== id) return;
    setSeries((s) => {
      const next = { ...s };
      for (const [k, v] of Object.entries(e.values)) next[k] = [...(s[k] ?? []), { ts: e.ts, value: v, anomaly: k in e.anomalies }].slice(-1200);
      return next;
    });
  });

  async function command(name: string, payload: Record<string, unknown>) {
    setBusy(name);
    try { await api.sendCommand(id, name, payload); loadMeta(); } finally { setBusy(null); }
  }

  if (!device) return <div className="grid flex-1 place-items-center"><Spinner className="h-6 w-6 text-brand-400" /></div>;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-5">
        <HealthRing value={device.health} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><StatusDot online={device.status === "online"} /><h1 className="text-2xl font-semibold text-white">{device.name}</h1></div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span className="font-mono">{device.id}</span><span>{device.type_label}</span><span>{device.location}</span>
            <span className="flex items-center gap-1"><Wifi className="h-3 w-3" />last seen {timeAgo(device.last_seen)}</span><span>fw {device.firmware}</span>
          </div>
        </div>
        <div className="flex rounded-xl bg-ink-900 p-1 text-xs">
          {WINDOWS.map((w) => <button key={w} onClick={() => setMinutes(w)} className={`rounded-lg px-3 py-1.5 ${minutes === w ? "bg-brand-500 text-ink-950" : "text-slate-400 hover:text-white"}`}>{w < 60 ? `${w}m` : `${w / 60}h`}</button>)}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {device.metrics.map((spec) => <MetricChart key={spec.key} spec={spec} points={series[spec.key] ?? []} />)}
        </div>
        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-white"><TrendingUp className="h-4 w-4 text-brand-400" /> Predictive maintenance</h2>
            <div className="space-y-3">
              {device.metrics.filter((m) => m.crit_high !== null).map((m) => {
                const f = device.forecasts[m.key];
                const latest = device.latest[m.key];
                const soon = f?.hours_to_threshold != null && f.r2 >= 0.5;
                return (
                  <div key={m.key} className="rounded-xl bg-ink-950/50 p-3">
                    <div className="flex justify-between text-sm"><span className="text-slate-300">{m.label}</span><span className={latest ? LEVEL_TEXT[latest.level] : ""}>{latest?.value} {m.unit}</span></div>
                    <div className="mt-1 text-xs text-slate-500">
                      {f ? <>trend {f.slope_per_hour > 0 ? "+" : ""}{f.slope_per_hour.toFixed(2)} {m.unit}/h · R² {f.r2}</> : "collecting data…"}
                    </div>
                    {soon && <div className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-300"><Timer className="h-3.5 w-3.5" /> reaches {m.crit_high} {m.unit} in ~{f!.hours_to_threshold! < 1 ? `${Math.round(f!.hours_to_threshold! * 60)} min` : `${f!.hours_to_threshold!.toFixed(1)} h`}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-white"><Power className="h-4 w-4 text-brand-400" /> Remote control</h2>
            <div className="flex flex-wrap gap-2">
              <button className={device.relay_on ? "btn-ghost" : "btn-primary"} disabled={!!busy} onClick={() => command("set_relay", { on: !device.relay_on })}>
                {busy === "set_relay" ? <Spinner /> : <Power className="h-4 w-4" />} Relay {device.relay_on ? "ON → turn off" : "OFF → turn on"}
              </button>
              <select className="input w-auto" value={device.sampling_interval} onChange={(e) => command("set_interval", { seconds: Number(e.target.value) })}>
                {[1, 5, 10, 30, 60].map((s) => <option key={s} value={s}>every {s}s</option>)}
              </select>
              <button className="btn-ghost" disabled={!!busy} onClick={() => command("reboot", {})}><RefreshCcw className="h-4 w-4" /> Reboot</button>
            </div>
            <ul className="mt-4 space-y-1.5 text-xs">
              {commands.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg bg-ink-950/50 px-3 py-2">
                  <span className="font-mono text-slate-300">{c.name} {JSON.stringify(c.payload)}</span>
                  <span className={c.status === "acked" ? "text-emerald-300" : c.status === "failed" ? "text-rose-300" : "text-amber-200"}>{c.status}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold text-white"><ScanSearch className="h-4 w-4 text-brand-400" /> Multivariate scan</h2>
              <button className="btn-ghost px-3 py-1 text-xs" disabled={busy === "scan"} onClick={async () => { setBusy("scan"); setScan(await api.anomalyScan(id, minutes)); setBusy(null); }}>
                {busy === "scan" ? <Spinner /> : "Run Isolation Forest"}
              </button>
            </div>
            {!scan ? <p className="text-xs text-slate-500">Finds readings whose <em>combination</em> of metrics is unusual, even when each metric is within limits.</p> : (
              <div>
                <p className="mb-2 text-xs text-slate-400">{scan.samples} samples · {scan.anomalies.length} outliers</p>
                <div className="max-h-48 space-y-1 overflow-y-auto font-mono text-[11px]">
                  {scan.anomalies.slice(0, 10).map((a) => (
                    <div key={a.ts} className="flex justify-between rounded bg-ink-950/50 px-2 py-1 text-slate-300">
                      <span>{fmtTime(a.ts)}</span><span>{scan.metrics.map((k) => `${k.slice(0, 4)} ${a[k]}`).join(" · ")}</span><span className="text-rose-300">{a.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-white"><Clock className="h-4 w-4 text-brand-400" /> Active alerts</h2>
            <div className="space-y-2">
              {alerts.length === 0 && <p className="text-sm text-slate-500">No active alerts.</p>}
              {alerts.map((a) => (
                <div key={a.id} className="rounded-xl bg-ink-950/50 p-3">
                  <div className="flex items-center gap-2"><SeverityBadge severity={a.severity} /><span className="text-xs text-slate-400">{KIND_LABEL[a.kind]}</span></div>
                  <p className="mt-1 text-[13px] text-slate-300">{a.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
