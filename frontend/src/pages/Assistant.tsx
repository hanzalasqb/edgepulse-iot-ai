import { Bot, Check, Power, SendHorizontal, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import { Spinner } from "../components/ui";
import { api } from "../lib/client";
import type { Proposal } from "../lib/types";

interface Msg { role: "user" | "assistant"; content: string; tools?: { name: string; summary?: string; pending?: boolean }[]; proposal?: Proposal & { state?: "pending" | "sent" | "dismissed" } }

const SUGGESTIONS = [
  "Which devices need attention right now?",
  "Why is pump-01 unhealthy?",
  "What's happening in cold-room-03?",
  "Turn off the relay on pump-01",
];

export default function Assistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const patch = (fn: (m: Msg) => Msg) => setMessages((p) => [...p.slice(0, -1), fn(p[p.length - 1])]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((p) => [...p, { role: "user", content: text }, { role: "assistant", content: "", tools: [] }]);
    setInput(""); setBusy(true); setError(null);
    try {
      await api.assistant(text, history, (e) => {
        if (e.type === "token") patch((m) => ({ ...m, content: m.content + e.text }));
        else if (e.type === "tool_call") patch((m) => ({ ...m, tools: [...(m.tools ?? []), { name: e.name, pending: true }] }));
        else if (e.type === "tool_result") patch((m) => {
          const tools = [...(m.tools ?? [])], i = tools.findIndex((t) => t.pending && t.name === e.name);
          if (i >= 0) tools[i] = { name: e.name, summary: e.summary };
          return { ...m, tools };
        });
        else if (e.type === "proposal") patch((m) => ({ ...m, proposal: { device_id: e.device_id, device_name: e.device_name, name: e.name, payload: e.payload, reason: e.reason, state: "pending" } }));
        else if (e.type === "error") setError(e.message);
      });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function decide(index: number, run: boolean) {
    const p = messages[index].proposal!;
    if (run) await api.sendCommand(p.device_id, p.name, p.payload);
    setMessages((all) => all.map((m, i) => (i === index ? { ...m, proposal: { ...p, state: run ? "sent" : "dismissed" } } : m)));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl px-6 pt-16 text-center md:pt-24">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-indigo-500 text-ink-950 shadow-2xl shadow-brand-500/30"><Bot className="h-8 w-8" /></div>
            <h1 className="text-3xl font-semibold text-white">Ask EdgePulse AI</h1>
            <p className="mt-3 text-slate-400">An AI agent that reads live telemetry, alerts and forecasts to diagnose equipment and suggest maintenance actions. Remote commands always need your confirmation.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="card flex items-center gap-2 p-4 text-left text-sm text-slate-200 hover:border-brand-500/40"><Sparkles className="h-4 w-4 shrink-0 text-brand-400" />{s}</button>)}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
            {messages.map((m, i) => m.role === "user" ? (
              <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-brand-500/20 bg-brand-500/10 px-4 py-3 text-slate-100">{m.content}</div></div>
            ) : (
              <div key={i} className="flex gap-3">
                <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-indigo-500 text-ink-950"><Bot className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  {!!m.tools?.length && (
                    <div className="mb-3 space-y-1.5">
                      {m.tools.map((t, j) => (
                        <div key={j} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-xs">
                          {t.pending ? <Spinner className="h-3.5 w-3.5 text-brand-300" /> : <Wrench className="h-3.5 w-3.5 text-brand-300" />}
                          <span className="font-mono text-brand-300">{t.name}</span><span className="truncate text-slate-400">{t.pending ? "running…" : t.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.content ? <Markdown>{m.content}</Markdown> : busy && i === messages.length - 1 ? <Spinner className="text-slate-500" /> : null}
                  {m.proposal && (
                    <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-amber-200"><Power className="h-4 w-4" /> Confirm command</div>
                      <p className="mt-1 text-sm text-slate-300"><span className="font-mono">{m.proposal.name}</span> {JSON.stringify(m.proposal.payload)} on <strong>{m.proposal.device_name}</strong></p>
                      {m.proposal.state === "pending" ? (
                        <div className="mt-3 flex gap-2">
                          <button className="btn-primary px-3 py-1.5" onClick={() => decide(i, true)}><Check className="h-4 w-4" /> Execute</button>
                          <button className="btn-ghost px-3 py-1.5" onClick={() => decide(i, false)}><X className="h-4 w-4" /> Dismiss</button>
                        </div>
                      ) : <p className="mt-2 text-xs text-slate-400">{m.proposal.state === "sent" ? "✓ Command sent to the device." : "Dismissed."}</p>}
                    </div>
                  )}
                  {api.demo && m.content && <div className="mt-2 text-[10px] uppercase tracking-wider text-slate-600">Demo response · generated from live tool output</div>}
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>
      <div className="border-t border-white/[0.06] px-4 py-4">
        <div className="mx-auto max-w-3xl">
          {error && <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
          <form className="card flex items-end gap-2 p-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about a device, alert or trend…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-slate-100 outline-none placeholder:text-slate-500" />
            <button className="btn-primary h-11 w-11 p-0" disabled={busy || !input.trim()}>{busy ? <Spinner /> : <SendHorizontal className="h-5 w-5" />}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
