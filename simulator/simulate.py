"""EdgePulse device fleet simulator.

Publishes realistic telemetry for the 5 demo devices over HTTP (default) or MQTT and can
inject faults so you can watch anomaly detection, forecasting and alerting work end to end.

    python simulate.py --url http://localhost:8000 --key demo-device-key --backfill 30 --scenario demo
    python simulate.py --mqtt localhost --key demo-device-key --scenario bearing-wear
"""
import argparse
import json
import math
import random
import time
from datetime import UTC, datetime, timedelta

import httpx

DEVICES = {"pump-01": "pump", "hvac-02": "hvac", "cold-room-03": "cold_room", "solar-inv-04": "solar_inverter", "greenhouse-05": "greenhouse"}
SCENARIOS = {"bearing-wear": "pump-01", "door-open": "cold-room-03", "voltage-sag": "solar-inv-04", "irrigation-fault": "greenhouse-05", "hvac-overheat": "hvac-02"}


DEMO_FAULTS = {"bearing-wear", "door-open", "voltage-sag"}


class FaultClock:
    def __init__(self, scenario: str, start_after_min: float):
        presets = {"all": set(SCENARIOS), "demo": DEMO_FAULTS, "none": set()}
        self.active = presets.get(scenario, {scenario})
        self.start_after = start_after_min

    def minutes_into(self, name: str, elapsed_min: float) -> float:
        return max(0.0, elapsed_min - self.start_after) if name in self.active else 0.0


def sample(device_id: str, kind: str, t: datetime, elapsed_min: float, faults: FaultClock, state: dict) -> dict:
    g = random.gauss
    hour = t.hour + t.minute / 60
    day = math.sin((hour - 6) / 24 * 2 * math.pi)
    if kind == "pump":
        wear = faults.minutes_into("bearing-wear", elapsed_min)
        return {"temperature": round(58 + 0.35 * wear + g(0, 0.6), 2), "vibration": round(2.6 + 0.09 * wear + abs(g(0, 0.18)), 3),
                "current": round(10 + 0.04 * wear + g(0, 0.25), 2)}
    if kind == "hvac":
        hot = faults.minutes_into("hvac-overheat", elapsed_min)
        return {"temperature": round(18 + 2 * day + 0.25 * hot + g(0, 0.3), 2), "humidity": round(52 + 4 * day + g(0, 1.5), 1),
                "current": round(6.5 + 0.03 * hot + g(0, 0.15), 2)}
    if kind == "cold_room":
        door = faults.minutes_into("door-open", elapsed_min) % 25  # door left open for 4 min every 25 min
        spike = 7 * math.sin(math.pi * door / 4) if 0 < door < 4 else 0
        compressor = 14 + 1.2 * math.sin(elapsed_min / 3) + (2.5 if spike > 1 else 0)  # works harder while the door is open
        return {"temperature": round(-18 + spike + g(0, 0.35), 2), "humidity": round(74 + spike + g(0, 2), 1),
                "current": round(compressor + g(0, 0.3), 2)}
    if kind == "solar_inverter":
        sun = max(0.0, math.sin((hour - 6) / 12 * math.pi))
        sag = faults.minutes_into("voltage-sag", elapsed_min)
        voltage = 231 + g(0, 1.8) - (28 if sag and random.random() < 0.06 else 0)
        return {"voltage": round(voltage, 1), "power": round(5.2 * sun + g(0, 0.08), 2), "temperature": round(34 + 9 * sun + g(0, 0.5), 2)}
    if kind == "greenhouse":
        state.setdefault("soil", 58.0)
        stuck = faults.minutes_into("irrigation-fault", elapsed_min) > 0
        state["soil"] -= 0.12 + random.random() * 0.05
        if state["soil"] < 32 and not stuck:
            state["soil"] = 60.0  # irrigation cycle
        return {"temperature": round(25 + 4 * day + g(0, 0.4), 2), "humidity": round(66 - 6 * day + g(0, 2), 1), "soil_moisture": round(max(state["soil"], 5), 1)}
    raise ValueError(kind)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--mqtt", help="MQTT broker host (publishes instead of HTTP)")
    parser.add_argument("--key", default="demo-device-key")
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--backfill", type=int, default=30, help="minutes of history to send first")
    parser.add_argument("--scenario", default="demo", choices=["demo", "all", "none", *SCENARIOS])
    parser.add_argument("--fault-after", type=float, default=10, help="minutes before faults start")
    args = parser.parse_args()

    faults = FaultClock(args.scenario, args.fault_after)
    states = {d: {} for d in DEVICES}
    mqtt_client = None
    if args.mqtt:
        import paho.mqtt.client as mqtt

        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="edgepulse-simulator")
        mqtt_client.connect(args.mqtt, 1883)
        mqtt_client.loop_start()
    http = httpx.Client(base_url=args.url, timeout=10)

    def send(device_id: str, values: dict, ts: datetime | None):
        if mqtt_client and ts is None:
            mqtt_client.publish(f"edgepulse/{device_id}/telemetry", json.dumps({"key": args.key, "values": values}), qos=1)
            return
        body = {"values": values, **({"ts": ts.isoformat()} if ts else {})}
        try:
            r = http.post(f"/api/ingest/{device_id}", json=body, headers={"X-Device-Key": args.key})
        except httpx.HTTPError as exc:  # backend restarting: keep the fleet running
            print(f"ingest error for {device_id}: {exc}; retrying next cycle")
            return
        if r.status_code >= 400:
            print("ingest failed", device_id, r.status_code, r.text[:120])

    start = datetime.now(UTC) - timedelta(minutes=args.backfill)
    steps = int(args.backfill * 60 / args.interval)
    print(f"Backfilling {args.backfill} min ({steps} samples per device)...")
    for i in range(steps):
        ts = start + timedelta(seconds=i * args.interval)
        for device_id, kind in DEVICES.items():
            send(device_id, sample(device_id, kind, ts, i * args.interval / 60, faults, states[device_id]), ts)
    print("Streaming live telemetry. Ctrl+C to stop.")
    elapsed = args.backfill
    while True:
        now = datetime.now(UTC)
        for device_id, kind in DEVICES.items():
            send(device_id, sample(device_id, kind, now, elapsed, faults, states[device_id]), None)
        time.sleep(args.interval)
        elapsed += args.interval / 60


if __name__ == "__main__":
    main()
