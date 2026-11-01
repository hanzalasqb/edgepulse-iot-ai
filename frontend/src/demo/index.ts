import type { Api } from "../lib/api";
import { demoAssistant } from "./assistant";
import { TYPES, fleet } from "./engine";

const USER = { id: 1, email: "engineer@demo.local", name: "Demo Engineer" };

export const demoApi: Api = {
  demo: true,
  login: async () => ({ access_token: "demo", user: USER }),
  register: async () => ({ access_token: "demo", user: USER }),
  me: async () => USER,
  fleet: async () => {
    const all = fleet.devices.map((d) => fleet.summary(d)), open = fleet.open();
    return { devices: all.length, online: all.filter((d) => d.status === "online").length, open_alerts: open.length,
      critical_alerts: open.filter((a) => a.severity === "critical").length, avg_health: Math.round(all.reduce((n, d) => n + d.health, 0) / all.length),
      readings_per_minute: all.reduce((n, d) => n + Object.keys(d.latest).length, 0) * 30 };
  },
  devices: async () => fleet.devices.map((d) => fleet.summary(d)),
  device: async (id) => { const d = fleet.get(id); return { ...fleet.summary(d), metrics: TYPES[d.type].metrics, forecasts: fleet.forecasts(d) }; },
  telemetry: async (id, minutes) => ({ series: fleet.series(fleet.get(id), minutes) }),
  anomalyScan: async (id, minutes) => {
    // Lightweight multivariate stand-in for the backend's Isolation Forest: distance from the per-metric median in MAD units.
    const d = fleet.get(id), keys = TYPES[d.type].metrics.map((m) => m.key), series = fleet.series(d, minutes);
    const n = Math.min(...keys.map((k) => series[k]?.length ?? 0));
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const stats = keys.map((k) => { const v = series[k].slice(-n).map((p) => p.value), m = med(v); return { m, mad: med(v.map((x) => Math.abs(x - m))) || 1 }; });
    const rows = Array.from({ length: n }, (_, i) => {
      const row: Record<string, number | string> = { ts: series[keys[0]].slice(-n)[i].ts };
      let score = 0;
      keys.forEach((k, j) => { const v = series[k].slice(-n)[i].value; row[k] = v; score += ((v - stats[j].m) / stats[j].mad) ** 2; });
      return { ...row, score: +Math.sqrt(score / keys.length).toFixed(3) } as { ts: string; score: number } & Record<string, number | string>;
    });
    return { device_id: id, samples: n, metrics: keys, anomalies: rows.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.round(n * 0.03))) };
  },
  alerts: async (status, deviceId) => fleet.alerts.filter((a) => (!deviceId || a.device_id === deviceId) && (!status || (status === "active" ? a.status !== "resolved" : a.status === status))).slice(0, 100),
  setAlertStatus: async (id, action) => {
    const a = fleet.alerts.find((x) => x.id === id)!;
    a.status = action === "ack" ? "acknowledged" : "resolved";
    a.updated_at = new Date().toISOString();
    fleet.emit({ type: "alert", alert: a });
    return a;
  },
  sendCommand: async (id, name, payload) => fleet.command(id, name, payload),
  commands: async (id) => fleet.commands.filter((c) => c.device_id === id),
  assistant: async (message, _history, onEvent) => { await demoAssistant(message, onEvent); onEvent({ type: "done" }); },
  subscribe: (fn) => { fleet.listeners.add(fn); return () => { fleet.listeners.delete(fn); }; },
};
