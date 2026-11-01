export type Level = "normal" | "warning" | "critical";
export interface User { id: number; email: string; name: string }
export interface AuthResult { access_token: string; user: User }

export interface MetricSpec { key: string; label: string; unit: string; warn_high: number | null; crit_high: number | null; warn_low: number | null; crit_low: number | null }
export interface LatestValue { value: number; ts: string; level: Level; unit: string; label: string }
export interface DeviceSummary {
  id: string; name: string; type: string; type_label: string; location: string; firmware: string;
  status: "online" | "offline"; last_seen: string | null; sampling_interval: number; relay_on: boolean;
  health: number; open_alerts: number; critical_alerts: number; latest: Record<string, LatestValue>;
}
export interface Forecast { slope_per_hour: number; r2: number; current_trend_value: number; threshold: number; hours_to_threshold: number | null }
export interface DeviceDetail extends DeviceSummary { metrics: MetricSpec[]; forecasts: Record<string, Forecast> }
export interface Point { ts: string; value: number; anomaly: boolean }
export interface Alert {
  id: number; device_id: string; metric: string; kind: "threshold" | "anomaly" | "forecast" | "offline";
  severity: "critical" | "warning" | "info"; message: string; value: number | null; status: "open" | "acknowledged" | "resolved";
  created_at: string; updated_at: string;
}
export interface Command { id: number; device_id: string; name: string; payload: Record<string, unknown>; status: string; issued_by: string; created_at: string; acked_at: string | null }
export interface FleetSummary { devices: number; online: number; open_alerts: number; critical_alerts: number; avg_health: number; readings_per_minute: number }
export interface ScanResult { device_id: string; samples: number; metrics: string[]; anomalies: ({ ts: string; score: number } & Record<string, number | string>)[] }

export type LiveEvent =
  | { type: "telemetry"; device_id: string; ts: string; values: Record<string, number>; levels: Record<string, Level>; anomalies: Record<string, number> }
  | { type: "alert"; alert: Alert }
  | { type: "device_status"; device_id: string; status: string }
  | { type: "command"; command: Command };

export interface Proposal { device_id: string; device_name: string; name: string; payload: Record<string, unknown>; reason: string }
export type AssistantEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; summary: string }
  | ({ type: "proposal" } & Proposal)
  | { type: "error"; message: string }
  | { type: "done" };
