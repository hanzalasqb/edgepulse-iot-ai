import { Activity, Bell, Bot, Cpu, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, tokenStore } from "../lib/client";
import { useApp } from "../lib/context";
import { useLiveRefresh } from "../lib/live";
import type { DeviceSummary } from "../lib/types";
import { StatusDot } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/assistant", label: "AI Assistant", icon: Bot },
];

export default function Layout() {
  const { user, setUser } = useApp();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const load = useCallback(() => { api.devices().then(setDevices).catch(() => {}); }, []);
  useEffect(load, [load]);
  useLiveRefresh(load, 5000);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? "bg-brand-500/10 text-brand-300" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`;

  const sidebar = (
    <aside className="flex h-full w-72 flex-col border-r border-white/[0.06] bg-ink-900/90">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-indigo-500 text-ink-950 shadow-lg shadow-brand-500/20"><Activity className="h-5 w-5" /></div>
        <div>
          <div className="font-semibold tracking-tight text-white">Edge<span className="text-brand-400">Pulse</span></div>
          <div className="text-[11px] text-slate-500">AI monitoring for embedded systems</div>
        </div>
      </div>
      <nav className="space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass} onClick={() => setOpen(false)}><Icon className="h-4 w-4" /> {label}</NavLink>
        ))}
      </nav>
      <div className="mt-6 px-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Devices</div>
      <div className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3">
        {devices.map((d) => (
          <NavLink key={d.id} to={`/devices/${d.id}`} className={linkClass} onClick={() => setOpen(false)}>
            <Cpu className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            {d.critical_alerts > 0 ? <span className="rounded-full bg-rose-500/20 px-1.5 text-[10px] font-semibold text-rose-300">{d.critical_alerts}</span>
              : d.open_alerts > 0 ? <span className="rounded-full bg-amber-400/15 px-1.5 text-[10px] font-semibold text-amber-200">{d.open_alerts}</span> : null}
            <StatusDot online={d.status === "online"} />
          </NavLink>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-white/[0.06] px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-500 text-xs font-bold text-white">{user?.name.slice(0, 1)}</div>
        <div className="min-w-0 flex-1"><div className="truncate text-sm text-slate-200">{user?.name}</div><div className="truncate text-[11px] text-slate-500">{user?.email}</div></div>
        {!api.demo && <button title="Sign out" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white" onClick={() => { tokenStore.set(null); setUser(null); navigate("/login"); }}><LogOut className="h-4 w-4" /></button>}
      </div>
    </aside>
  );

  return (
    <div className="flex h-full flex-col">
      {api.demo && (
        <div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-1.5 text-center text-xs text-amber-200">
          <strong>Live demo</strong> · 5 simulated devices stream telemetry in your browser (faults are injected over time). The full stack uses FastAPI, MQTT, WebSockets and an LLM agent.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:block">{sidebar}</div>
        {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} /><div className="relative h-full">{sidebar}</div></div>}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 lg:hidden">
            <button onClick={() => setOpen(!open)} className="text-slate-300">{open ? <X /> : <Menu />}</button>
            <span className="font-semibold text-white">EdgePulse</span>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
