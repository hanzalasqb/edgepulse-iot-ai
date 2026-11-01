import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { Alert, Level } from "../lib/types";

export const LEVEL_TEXT: Record<Level, string> = { normal: "text-slate-100", warning: "text-amber-300", critical: "text-rose-400" };
export const SEVERITY_STYLE: Record<Alert["severity"], string> = {
  critical: "border-rose-500/40 bg-rose-500/10 text-rose-300", warning: "border-amber-400/40 bg-amber-400/10 text-amber-200", info: "border-sky-400/40 bg-sky-400/10 text-sky-300",
};
export const KIND_LABEL: Record<Alert["kind"], string> = { threshold: "Limit", anomaly: "Anomaly", forecast: "Forecast", offline: "Offline" };

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <LoaderCircle className={`animate-spin ${className}`} />;
}

export function SeverityBadge({ severity }: { severity: Alert["severity"] }) {
  return <span className={`chip uppercase tracking-wide ${SEVERITY_STYLE[severity]}`}>{severity}</span>;
}

export function StatusDot({ online }: { online: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-400" : "bg-slate-600"}`} />
    </span>
  );
}

export function HealthRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const color = value >= 80 ? "#34d399" : value >= 50 ? "#fbbf24" : "#f43f5e";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90">
        <circle cx="28" cy="28" r={r} stroke="#1b2436" strokeWidth="5" fill="none" />
        <circle cx="28" cy="28" r={r} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (value / 100) * c} style={{ transition: "stroke-dashoffset .6s" }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-white">{value}</span>
    </div>
  );
}

export function Sparkline({ data, color = "#22d3ee" }: { data: number[]; color?: string }) {
  return (
    <div className="h-9 w-full">
      <ResponsiveContainer>
        <LineChart data={data.map((v, i) => ({ i, v }))}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Kpi({ icon, label, value, sub, tone = "text-white" }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/10 text-brand-300">{icon}</div>
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime()) / 1000);
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export const toDate = (iso: string) => new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
