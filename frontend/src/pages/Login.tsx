import { Activity } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../components/ui";
import { api, tokenStore } from "../lib/client";
import { useApp } from "../lib/context";

export default function Login() {
  const { setUser } = useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = mode === "login" ? await api.login(form.email, form.password) : await api.register(form.name, form.email, form.password);
      tokenStore.set(res.access_token);
      setUser(res.user);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.15),transparent_60%)] px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-8">
        <div className="mb-2 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-indigo-500 text-ink-950"><Activity /></div>
          <div>
            <h1 className="text-lg font-semibold text-white">EdgePulse</h1>
            <p className="text-xs text-slate-400">{mode === "login" ? "Sign in to your monitoring workspace" : "Create your engineer account"}</p>
          </div>
        </div>
        {mode === "register" && (
          <input className="input" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
        )}
        <input className="input" type="email" placeholder="Work email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="input" type="password" placeholder="Password (min. 8 characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} {mode === "login" ? "Sign in" : "Create account"}</button>
        <p className="text-center text-xs text-slate-400">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button type="button" className="text-brand-300 hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}
