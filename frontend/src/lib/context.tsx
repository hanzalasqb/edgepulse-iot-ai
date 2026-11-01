import { createContext, useContext } from "react";
import type { User } from "./types";

export interface AppState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppContext");
  return ctx;
}
