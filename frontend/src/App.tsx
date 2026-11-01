import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { api, tokenStore } from "./lib/client";
import { AppContext } from "./lib/context";
import { LiveProvider } from "./lib/live";
import type { User } from "./lib/types";
import Alerts from "./pages/Alerts";
import Assistant from "./pages/Assistant";
import DeviceView from "./pages/DeviceView";
import Login from "./pages/Login";
import Overview from "./pages/Overview";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!api.demo && !tokenStore.get()) { setReady(true); return; }
    api.me().then(setUser).catch(() => tokenStore.set(null)).finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="grid h-full place-items-center"><Spinner className="h-6 w-6 text-brand-400" /></div>;

  return (
    <AppContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route element={user ? <LiveProvider><Layout /></LiveProvider> : <Navigate to="/login" replace />}>
          <Route index element={<Overview />} />
          <Route path="devices/:id" element={<DeviceView />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="assistant" element={<Assistant />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppContext.Provider>
  );
}
