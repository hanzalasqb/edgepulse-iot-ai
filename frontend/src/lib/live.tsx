import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { api } from "./client";
import type { LiveEvent } from "./types";

type Listener = (e: LiveEvent) => void;
const LiveContext = createContext<Set<Listener> | null>(null);

/** One WebSocket (or demo simulator) subscription for the whole app, fanned out to components. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  useEffect(() => api.subscribe((e) => listeners.current.forEach((l) => l(e))), []);
  return <LiveContext.Provider value={listeners.current}>{children}</LiveContext.Provider>;
}

export function useLive(handler: Listener) {
  const set = useContext(LiveContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!set) return;
    const l: Listener = (e) => ref.current(e);
    set.add(l);
    return () => { set.delete(l); };
  }, [set]);
}

/** Re-run `load` when live events arrive, at most every `ms` milliseconds. */
export function useLiveRefresh(load: () => void, ms = 3000) {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive(() => {
    const wait = Math.max(0, last.current + ms - Date.now());
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { last.current = Date.now(); load(); }, wait);
  });
}
