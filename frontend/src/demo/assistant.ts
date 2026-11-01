// Demo stand-in for the LLM agent: calls the same "tools" against the in-browser fleet and
// writes the diagnosis from a template using the real computed numbers.
import type { AssistantEvent } from "../lib/types";
import { TYPES, fleet, trend } from "./engine";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function stream(text: string, emit: (e: AssistantEvent) => void) {
  const parts = text.match(/\S+\s*|\s+/g) ?? [];
  for (let i = 0; i < parts.length; i += 3) { emit({ type: "token", text: parts.slice(i, i + 3).join("") }); await sleep(16); }
}
async function tool<T>(name: string, args: Record<string, unknown>, run: () => T, summary: (r: T) => string, emit: (e: AssistantEvent) => void) {
  emit({ type: "tool_call", name, args });
  await sleep(450);
  const r = run();
  emit({ type: "tool_result", name, summary: summary(r) });
  return r;
}

const ALIASES: [RegExp, string][] = [[/pump/i, "pump-01"], [/hvac|air/i, "hvac-02"], [/cold|fridge|freezer/i, "cold-room-03"], [/solar|inverter|voltage/i, "solar-inv-04"], [/green|soil|irrigat/i, "greenhouse-05"]];
const deviceIn = (text: string) => text.match(/(pump-01|hvac-02|cold-room-03|solar-inv-04|greenhouse-05)/i)?.[1].toLowerCase() ?? ALIASES.find(([re]) => re.test(text))?.[1];

function stats(id: string, key: string, minutes = 30) {
  const d = fleet.get(id), spec = TYPES[d.type].metrics.find((s) => s.key === key)!;
  const pts = (d.series[key] ?? []).filter((p) => p.t >= Date.now() - minutes * 60_000);
  const vals = pts.map((p) => p.v), first = vals[0], last = vals.at(-1)!;
  return { spec, first, last, min: Math.min(...vals), max: Math.max(...vals), anomalies: pts.filter((p) => p.z !== null && Math.abs(p.z) >= 4).length,
    fc: trend(pts.slice(-120).map((p) => ({ t: p.t, v: p.v })), spec.crit_high) };
}

const DIAGNOSIS: Record<string, string> = {
  pump: "Rising **vibration together with motor temperature and current** is the classic signature of **bearing wear or shaft misalignment** (cavitation is less likely while flow is stable).",
  cold_room: "Short temperature and humidity spikes while the compressor current rises point to **warm-air ingress — most likely the door being left open** or a failing door seal.",
  solar_inverter: "Brief **grid voltage sags** with stable output power indicate **upstream grid disturbances**, not an inverter fault.",
  hvac: "Supply-air temperature follows the daily load curve; no mechanical fault signature is present.",
  greenhouse: "Soil moisture follows the irrigation cycle (slow decline, then refill); humidity and temperature follow the daily cycle.",
};
const ACTIONS: Record<string, string[]> = {
  pump: ["Schedule a vibration spectrum analysis and inspect/grease the bearings within 24 h.", "Check coupling alignment and mounting bolts.", "If vibration exceeds 11.2 mm/s, stop the pump (relay off) to avoid catastrophic bearing failure."],
  cold_room: ["Check the door closer and seal; enable a door-open alarm after 60 s.", "Verify the evaporator is not icing up.", "Move sensitive stock if temperature stays above −12 °C for more than 15 min."],
  solar_inverter: ["Log the sag events and share them with the utility.", "Confirm the inverter's ride-through settings meet grid code."],
  hvac: ["No action needed; keep monitoring."],
  greenhouse: ["No action needed; confirm the irrigation schedule matches crop needs."],
};

export async function demoAssistant(message: string, emit: (e: AssistantEvent) => void) {
  const text = message.toLowerCase();
  const id = deviceIn(text);

  if (id && /relay|turn (off|on)|switch|stop|shut ?down|start|interval|reboot|restart/.test(text)) {
    const d = fleet.get(id);
    const name = /reboot|restart/.test(text) ? "reboot" : /interval/.test(text) ? "set_interval" : "set_relay";
    const payload = name === "set_relay" ? { on: /turn on|start|switch on/.test(text) } : name === "set_interval" ? { seconds: Number(text.match(/(\d+)\s*s/)?.[1] ?? 10) } : {};
    await tool("propose_command", { device_id: id, name, payload }, () => null, () => `proposed ${name} on ${id} (needs confirmation)`, emit);
    emit({ type: "proposal", device_id: id, device_name: d.name, name, payload, reason: `Requested by operator: "${message.slice(0, 80)}"` });
    return stream(`I've prepared the **${name.replace("_", " ")}** command for **${d.name}**. It will only run after you confirm it below — commands are never executed automatically.`, emit);
  }

  if (id) {
    const d = fleet.get(id);
    await tool("get_device_details", { device_id: id }, () => fleet.summary(d), (r) => `${r.name} · ${r.open_alerts} open alerts`, emit);
    const lines: string[] = [];
    for (const spec of TYPES[d.type].metrics) {
      const s = await tool("get_metric_stats", { device_id: id, metric: spec.key, minutes: 30 }, () => stats(id, spec.key), (r) => `${id}/${spec.key}: ${r.first}→${r.last} ${spec.unit}, ${r.anomalies} anomalies`, emit);
      const slope = s.fc ? `, trend ${s.fc.slope_per_hour > 0 ? "+" : ""}${s.fc.slope_per_hour.toFixed(2)} ${spec.unit}/h` : "";
      const eta = s.fc?.hours_to_threshold != null && s.fc.r2 > 0.5 ? ` → reaches the ${spec.crit_high} ${spec.unit} critical limit in **~${s.fc.hours_to_threshold < 1 ? Math.round(s.fc.hours_to_threshold * 60) + " min" : s.fc.hours_to_threshold.toFixed(1) + " h"}**` : "";
      lines.push(`- **${spec.label}**: ${s.first} → **${s.last} ${spec.unit}** (range ${s.min}–${s.max}${slope}; ${s.anomalies} anomalies)${eta}`);
    }
    const alerts = fleet.open(id);
    return stream(`**Diagnosis — ${d.name}**\n\n${DIAGNOSIS[d.type]}\n\n**Evidence (last 30 min)**\n\n${lines.join("\n")}\n\n${alerts.length ? `**Open alerts:** ${alerts.length} (${alerts.filter((a) => a.severity === "critical").length} critical)\n\n` : ""}**Recommended actions**\n\n${ACTIONS[d.type].map((a, i) => `${i + 1}. ${a}`).join("\n")}`, emit);
  }

  if (/alert/.test(text)) {
    const alerts = await tool("list_alerts", { status: "active" }, () => fleet.open(), (r) => `${r.length} alerts`, emit);
    const rows = alerts.slice(0, 8).map((a) => `| ${a.severity} | ${a.device_id} | ${a.kind} | ${a.message} |`).join("\n");
    return stream(`There are **${alerts.length} active alerts**.\n\n| Severity | Device | Type | Details |\n|---|---|---|---|\n${rows}`, emit);
  }

  const devices = await tool("get_fleet_status", {}, () => fleet.devices.map((d) => fleet.summary(d)), (r) => `${r.length} devices · ${r.filter((x) => x.status === "online").length} online · ${r.reduce((n, x) => n + x.open_alerts, 0)} open alerts`, emit);
  const ranked = [...devices].sort((a, b) => a.health - b.health);
  const body = ranked.map((d) => {
    const worst = Object.values(d.latest).filter((l) => l.level !== "normal").map((l) => `${l.label} ${l.value} ${l.unit} (${l.level})`).join(", ");
    return `- **${d.name}** — health **${d.health}/100**, ${d.open_alerts} open alerts${worst ? `; ${worst}` : ""}`;
  }).join("\n");
  return stream(`**Fleet overview**\n\n${body}\n\n**Priority:** ${ranked[0].health < 70 ? `start with **${ranked[0].name}** — ask me *"Why is ${ranked[0].id} unhealthy?"* for a diagnosis.` : "all devices are within normal limits."}`, emit);
}
