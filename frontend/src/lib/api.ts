import type {
  Alert, AssistantEvent, AuthResult, Command, DeviceDetail, DeviceSummary, FleetSummary, LiveEvent, Point, ScanResult, User,
} from "./types";

export interface Api {
  demo: boolean;
  login(email: string, password: string): Promise<AuthResult>;
  register(name: string, email: string, password: string): Promise<AuthResult>;
  me(): Promise<User>;
  fleet(): Promise<FleetSummary>;
  devices(): Promise<DeviceSummary[]>;
  device(id: string): Promise<DeviceDetail>;
  telemetry(id: string, minutes: number): Promise<{ series: Record<string, Point[]> }>;
  anomalyScan(id: string, minutes: number): Promise<ScanResult>;
  alerts(status?: string, deviceId?: string): Promise<Alert[]>;
  setAlertStatus(id: number, action: "ack" | "resolve"): Promise<Alert>;
  sendCommand(deviceId: string, name: string, payload: Record<string, unknown>): Promise<Command>;
  commands(deviceId: string): Promise<Command[]>;
  assistant(message: string, history: { role: string; content: string }[], onEvent: (e: AssistantEvent) => void): Promise<void>;
  subscribe(onEvent: (e: LiveEvent) => void): () => void;
}

const TOKEN_KEY = "edgepulse.token";
const BASE = import.meta.env.VITE_API_URL ?? "";

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
  return data as T;
}

export const httpApi: Api = {
  demo: false,
  login: (email, password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (name, email, password) => request("/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  me: () => request("/api/auth/me"),
  fleet: () => request("/api/fleet/summary"),
  devices: () => request("/api/devices"),
  device: (id) => request(`/api/devices/${id}`),
  telemetry: (id, minutes) => request(`/api/devices/${id}/telemetry?minutes=${minutes}`),
  anomalyScan: (id, minutes) => request(`/api/devices/${id}/anomaly-scan?minutes=${minutes}`),
  alerts: (status, deviceId) => request(`/api/alerts?${new URLSearchParams({ ...(status ? { status } : {}), ...(deviceId ? { device_id: deviceId } : {}) })}`),
  setAlertStatus: (id, action) => request(`/api/alerts/${id}/${action}`, { method: "POST" }),
  sendCommand: (deviceId, name, payload) => request(`/api/devices/${deviceId}/commands`, { method: "POST", body: JSON.stringify({ name, payload }) }),
  commands: (deviceId) => request(`/api/devices/${deviceId}/commands`),
  async assistant(message, history, onEvent) {
    const res = await fetch(`${BASE}/api/assistant/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenStore.get() ?? ""}` },
      body: JSON.stringify({ message, history }),
    });
    if (!res.ok || !res.body) throw new Error("Assistant request failed");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const type = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (type && data !== undefined) onEvent({ ...JSON.parse(data), type } as AssistantEvent);
      }
    }
  },
  subscribe(onEvent) {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    let ping: ReturnType<typeof setInterval>;
    const connect = () => {
      const url = new URL(`${BASE || location.origin}/ws`.replace(/^http/, "ws"));
      url.searchParams.set("token", tokenStore.get() ?? "");
      ws = new WebSocket(url);
      ws.onopen = () => { retry = 1000; ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000); };
      ws.onmessage = (m) => onEvent(JSON.parse(m.data));
      ws.onclose = () => { clearInterval(ping); if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 15000))); };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  },
};
