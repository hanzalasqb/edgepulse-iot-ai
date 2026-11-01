// Browser-only fleet: simulator + the same detection pipeline as the backend
// (limits, modified z-score anomalies, linear-trend forecasts, alert lifecycle, health score).
import type { Alert, Command, DeviceSummary, Forecast, Level, LiveEvent, MetricSpec, Point } from "../lib/types";

type Spec = MetricSpec;
const m = (key: string, label: string, unit: string, l: Partial<Spec> = {}): Spec =>
  ({ key, label, unit, warn_high: null, crit_high: null, warn_low: null, crit_low: null, ...l });

export const TYPES: Record<string, { label: string; metrics: Spec[] }> = {
  pump: { label: "Industrial pump", metrics: [m("temperature", "Motor temperature", "°C", { warn_high: 75, crit_high: 85 }), m("vibration", "Vibration", "mm/s", { warn_high: 7.1, crit_high: 11.2 }), m("current", "Motor current", "A", { warn_high: 13, crit_high: 15 })] },
  cold_room: { label: "Cold room", metrics: [m("temperature", "Air temperature", "°C", { warn_high: -12, crit_high: -8 }), m("humidity", "Humidity", "%", { warn_high: 90, crit_high: 95 }), m("current", "Compressor current", "A", { warn_high: 18, crit_high: 22 })] },
  hvac: { label: "HVAC unit", metrics: [m("temperature", "Supply air temperature", "°C", { warn_high: 26, crit_high: 30, warn_low: 12, crit_low: 8 }), m("humidity", "Humidity", "%", { warn_high: 70, crit_high: 80 }), m("current", "Fan current", "A", { warn_high: 9, crit_high: 11 })] },
  solar_inverter: { label: "Solar inverter", metrics: [m("voltage", "Grid voltage", "V", { warn_high: 250, crit_high: 255, warn_low: 210, crit_low: 200 }), m("power", "Output power", "kW"), m("temperature", "Heatsink temperature", "°C", { warn_high: 70, crit_high: 80 })] },
  greenhouse: { label: "Greenhouse controller", metrics: [m("temperature", "Air temperature", "°C", { warn_high: 32, crit_high: 36, warn_low: 12, crit_low: 8 }), m("humidity", "Humidity", "%", { warn_high: 85, crit_high: 92, warn_low: 40, crit_low: 30 }), m("soil_moisture", "Soil moisture", "%", { warn_low: 25, crit_low: 15 })] },
};
const DEVICES: [string, string, string, string][] = [
  ["pump-01", "Cooling Water Pump 1", "pump", "Plant A · Pump house"],
  ["hvac-02", "Rooftop HVAC 2", "hvac", "Building B · Roof"],
  ["cold-room-03", "Cold Room 3", "cold_room", "Warehouse · Bay 3"],
  ["solar-inv-04", "Solar Inverter 4", "solar_inverter", "Roof array · String 4"],
  ["greenhouse-05", "Greenhouse 5", "greenhouse", "R&D Farm · House 5"],
];

export const levelOf = (s: Spec, v: number): Level =>
  (s.crit_high !== null && v >= s.crit_high) || (s.crit_low !== null && v <= s.crit_low) ? "critical"
    : (s.warn_high !== null && v >= s.warn_high) || (s.warn_low !== null && v <= s.warn_low) ? "warning" : "normal";

const ANOMALY_Z = 4;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
function zscore(window: number[], v: number): number | null {
  if (window.length < 30) return null;
  const med = median(window);
  let mad = median(window.map((x) => Math.abs(x - med)));
  if (mad < 1e-9) mad = window.reduce((n, x) => n + Math.abs(x - med), 0) / window.length || 1e-9;
  return (0.6745 * (v - med)) / mad;
}
export function trend(points: { t: number; v: number }[], threshold: number | null): Forecast | null {
  if (points.length < 10 || threshold === null) return null;
  const t0 = points[0].t, xs = points.map((p) => (p.t - t0) / 3.6e6), ys = points.map((p) => p.v);
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx, icpt = my - slope * mx;
  let ssr = 0, sst = 0;
  for (let i = 0; i < n; i++) { ssr += (ys[i] - (slope * xs[i] + icpt)) ** 2; sst += (ys[i] - my) ** 2; }
  const r2 = Math.max(0, 1 - ssr / (sst || 1e-9)), current = slope * xs[n - 1] + icpt;
  const hours = slope > 0 && current < threshold ? (threshold - current) / slope : null;
  return { slope_per_hour: +slope.toFixed(4), r2: +r2.toFixed(3), current_trend_value: +current.toFixed(3), threshold, hours_to_threshold: hours === null ? null : +hours.toFixed(2) };
}
const fmtHours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
const gauss = (s: number) => s * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());

interface DevState { id: string; name: string; type: string; location: string; relay: boolean; interval: number; online: boolean; lastSeen: number; soil: number; series: Record<string, { t: number; v: number; z: number | null }[]>; count: number }

class DemoFleet {
  devices: DevState[] = DEVICES.map(([id, name, type, location]) => ({ id, name, type, location, relay: true, interval: 5, online: true, lastSeen: 0, soil: 52, series: {}, count: 0 }));
  alerts: Alert[] = [];
  commands: Command[] = [];
  listeners = new Set<(e: LiveEvent) => void>();
  private nextAlert = 1;
  private nextCommand = 1;
  private faultMinutes = 0;

  constructor() {
    const start = Date.now() - 45 * 60_000;
    for (let i = 0; i <= 270; i++) this.tick(start + i * 10_000, i * 10 / 60, false); // 45 min of history @10 s
    this.faultMinutes = 45;
    setInterval(() => { this.faultMinutes += 10 / 60 * 1.5; this.tick(Date.now(), this.faultMinutes, true); }, 2000);
  }

  private sample(d: DevState, t: number, minutes: number): Record<string, number> {
    const date = new Date(t), hour = date.getHours() + date.getMinutes() / 60, day = Math.sin(((hour - 6) / 24) * 2 * Math.PI);
    const wear = Math.max(0, minutes - 5);
    switch (d.type) {
      case "pump":
        if (!d.relay) return { temperature: +(Math.max(32, 58 + 0.3 * wear - 10) + gauss(0.4)).toFixed(2), vibration: +(0.2 + Math.abs(gauss(0.05))).toFixed(3), current: 0 };
        return { temperature: +(58 + 0.32 * wear + gauss(0.6)).toFixed(2), vibration: +(2.6 + 0.085 * wear + Math.abs(gauss(0.18))).toFixed(3), current: +(10 + 0.04 * wear + gauss(0.25)).toFixed(2) };
      case "hvac":
        return { temperature: +(18 + 2 * day + gauss(0.3)).toFixed(2), humidity: +(52 + 4 * day + gauss(1.5)).toFixed(1), current: +(6.5 + gauss(0.15)).toFixed(2) };
      case "cold_room": {
        const door = (minutes % 25), spike = door > 18 && door < 22 ? 7 * Math.sin((Math.PI * (door - 18)) / 4) : 0;
        return { temperature: +(-18 + spike + gauss(0.35)).toFixed(2), humidity: +(74 + spike + gauss(2)).toFixed(1), current: +(14 + 1.2 * Math.sin(minutes / 3) + (spike > 1 ? 2.5 : 0) + gauss(0.3)).toFixed(2) };
      }
      case "solar_inverter": {
        const sun = Math.max(0.15, Math.sin(((hour - 6) / 12) * Math.PI));
        return { voltage: +(231 + gauss(1.8) - (minutes > 20 && Math.random() < 0.05 ? 28 : 0)).toFixed(1), power: +(5.2 * sun + gauss(0.08)).toFixed(2), temperature: +(34 + 9 * sun + gauss(0.5)).toFixed(2) };
      }
      default: {
        d.soil -= 0.11 + Math.random() * 0.05;
        if (d.soil < 32) d.soil = 60;
        return { temperature: +(25 + 4 * day + gauss(0.4)).toFixed(2), humidity: +(66 - 6 * day + gauss(2)).toFixed(1), soil_moisture: +d.soil.toFixed(1) };
      }
    }
  }

  private findAlert(id: string, metric: string, kind: string) {
    return this.alerts.find((a) => a.device_id === id && a.metric === metric && a.kind === kind && a.status !== "resolved");
  }
  private raise(id: string, metric: string, kind: Alert["kind"], severity: Alert["severity"], message: string, value: number | null, t: number, live: boolean) {
    const now = new Date(t).toISOString();
    let a = this.findAlert(id, metric, kind);
    if (!a) {
      a = { id: this.nextAlert++, device_id: id, metric, kind, severity, message, value, status: "open", created_at: now, updated_at: now };
      this.alerts.unshift(a);
      if (live) this.emit({ type: "alert", alert: a });
    } else {
      const escalate = a.severity !== "critical" && severity === "critical";
      Object.assign(a, { message, value, updated_at: now, severity: escalate ? "critical" : a.severity, status: escalate ? "open" : a.status });
      if (escalate && live) this.emit({ type: "alert", alert: a });
    }
  }
  private resolve(id: string, metric: string, kind: string, t: number, live: boolean) {
    const a = this.findAlert(id, metric, kind);
    if (a) { a.status = "resolved"; a.updated_at = new Date(t).toISOString(); if (live) this.emit({ type: "alert", alert: a }); }
  }

  private tick(t: number, minutes: number, live: boolean) {
    for (const d of this.devices) {
      const values = this.sample(d, t, minutes), levels: Record<string, Level> = {}, anomalies: Record<string, number> = {};
      d.count++;
      for (const spec of TYPES[d.type].metrics) {
        const v = values[spec.key], s = (d.series[spec.key] ??= []);
        const z = zscore(s.slice(-120).map((p) => p.v), v);
        s.push({ t, v, z });
        if (s.length > 1500) s.shift();
        const level = levelOf(spec, v);
        levels[spec.key] = level;
        if (level === "normal") this.resolve(d.id, spec.key, "threshold", t, live);
        else {
          const limit = level === "critical" ? (spec.crit_high !== null && v >= spec.crit_high ? spec.crit_high : spec.crit_low) : (spec.warn_high !== null && v >= spec.warn_high ? spec.warn_high : spec.warn_low);
          this.raise(d.id, spec.key, "threshold", level, `${spec.label} at ${v} ${spec.unit} crossed the ${level} limit (${limit} ${spec.unit})`, v, t, live);
        }
        if (z !== null && Math.abs(z) >= ANOMALY_Z) {
          anomalies[spec.key] = +z.toFixed(2);
          this.raise(d.id, spec.key, "anomaly", "warning", `Unusual ${spec.label.toLowerCase()}: ${v} ${spec.unit} vs baseline ${median(s.slice(-120, -1).map((p) => p.v)).toFixed(1)} ${spec.unit} (z = ${z.toFixed(1)})`, v, t, live);
        }
        if (d.count % 10 === 0 && spec.crit_high !== null && level !== "critical") {
          const fc = trend(s.slice(-120).map((p) => ({ t: p.t, v: p.v })), spec.crit_high);
          if (fc?.hours_to_threshold != null && fc.hours_to_threshold <= 6 && fc.r2 >= 0.5)
            this.raise(d.id, spec.key, "forecast", "warning", `${spec.label} rising ${fc.slope_per_hour > 0 ? "+" : ""}${fc.slope_per_hour.toFixed(2)} ${spec.unit}/h — predicted to reach ${spec.crit_high} ${spec.unit} in ~${fmtHours(fc.hours_to_threshold)}`, v, t, live);
          else if (fc && fc.hours_to_threshold === null) this.resolve(d.id, spec.key, "forecast", t, live);
        }
      }
      d.lastSeen = t;
      if (live) this.emit({ type: "telemetry", device_id: d.id, ts: new Date(t).toISOString(), values, levels, anomalies });
    }
  }

  emit(e: LiveEvent) { this.listeners.forEach((l) => l(e)); }

  open(id?: string) { return this.alerts.filter((a) => a.status !== "resolved" && (!id || a.device_id === id)); }
  health(d: DevState) { return d.online ? Math.max(0, 100 - this.open(d.id).reduce((n, a) => n + (a.severity === "critical" ? 35 : a.severity === "warning" ? 12 : 4), 0)) : 0; }

  summary(d: DevState): DeviceSummary {
    const latest: DeviceSummary["latest"] = {};
    for (const spec of TYPES[d.type].metrics) {
      const last = d.series[spec.key]?.at(-1);
      if (last) latest[spec.key] = { value: last.v, ts: new Date(last.t).toISOString(), level: levelOf(spec, last.v), unit: spec.unit, label: spec.label };
    }
    const open = this.open(d.id);
    return { id: d.id, name: d.name, type: d.type, type_label: TYPES[d.type].label, location: d.location, firmware: "1.4.2", status: d.online ? "online" : "offline",
      last_seen: new Date(d.lastSeen).toISOString(), sampling_interval: d.interval, relay_on: d.relay, health: this.health(d), open_alerts: open.length,
      critical_alerts: open.filter((a) => a.severity === "critical").length, latest };
  }

  forecasts(d: DevState) {
    const out: Record<string, Forecast> = {};
    for (const spec of TYPES[d.type].metrics) {
      const fc = trend((d.series[spec.key] ?? []).slice(-120).map((p) => ({ t: p.t, v: p.v })), spec.crit_high);
      if (fc) out[spec.key] = fc;
    }
    return out;
  }

  series(d: DevState, minutes: number): Record<string, Point[]> {
    const since = Date.now() - minutes * 60_000, out: Record<string, Point[]> = {};
    for (const [k, s] of Object.entries(d.series)) out[k] = s.filter((p) => p.t >= since).map((p) => ({ ts: new Date(p.t).toISOString(), value: p.v, anomaly: p.z !== null && Math.abs(p.z) >= ANOMALY_Z }));
    return out;
  }

  command(id: string, name: string, payload: Record<string, unknown>): Command {
    const d = this.get(id);
    if (name === "set_relay") d.relay = Boolean(payload.on);
    if (name === "set_interval") d.interval = Number(payload.seconds);
    const c: Command = { id: this.nextCommand++, device_id: id, name, payload, status: "pending", issued_by: "analyst@demo.local", created_at: new Date().toISOString(), acked_at: null };
    this.commands.unshift(c);
    this.emit({ type: "command", command: c });
    setTimeout(() => { c.status = "acked"; c.acked_at = new Date().toISOString(); this.emit({ type: "command", command: c }); }, 1200);
    return c;
  }

  get(id: string) {
    const d = this.devices.find((x) => x.id === id);
    if (!d) throw new Error("Device not found");
    return d;
  }
}

// Only instantiated in the demo build (VITE_DEMO=true), so the real app never runs the simulator.
export const fleet = (import.meta.env.VITE_DEMO === "true" ? new DemoFleet() : null) as DemoFleet;
