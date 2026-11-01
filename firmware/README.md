# EdgePulse ESP32 firmware

Reference firmware for an industrial-pump sensor node. It publishes telemetry over MQTT and
receives remote commands from the EdgePulse dashboard and AI assistant (after operator confirmation).

## Bill of materials & wiring

| Part | Purpose | ESP32 pin |
|---|---|---|
| DS18B20 (waterproof) | Motor housing temperature | GPIO 4 (+4.7 kΩ pull-up to 3V3) |
| ADXL335 accelerometer (X axis) | Vibration (RMS, mm/s after calibration) | GPIO 34 (ADC1) |
| ACS712-20A | Motor current (RMS) | GPIO 35 (ADC1, use a divider: module outputs up to 5 V) |
| 5 V relay module | Pump contactor control | GPIO 26 |

> ADC1 pins are used because ADC2 is unavailable while Wi-Fi is active on the ESP32.

## Build & flash (PlatformIO)

```bash
cd firmware
cp include/secrets.example.h include/secrets.h   # Wi-Fi, MQTT host, DEVICE_ID, DEVICE_KEY
pio run -t upload
pio device monitor
```

`DEVICE_KEY` is the key returned once when you provision the device in EdgePulse
(`POST /api/devices`). The backend rejects telemetry with a wrong key.

## MQTT contract

| Topic | Direction | Payload |
|---|---|---|
| `edgepulse/<id>/telemetry` | device → cloud | `{"key": "...", "values": {"temperature": 58.2, "vibration": 2.7, "current": 10.1}}` |
| `edgepulse/<id>/cmd` | cloud → device | `{"command_id": 7, "name": "set_relay", "payload": {"on": false}}` |
| `edgepulse/<id>/ack` | device → cloud | `{"key": "...", "command_id": 7, "ok": true}` |
| `edgepulse/<id>/status` | device (retained, LWT) | `online` / `offline` |

Supported commands: `set_relay {on}`, `set_interval {seconds}`, `reboot`.

## Robustness

- Wi-Fi and MQTT auto-reconnect with exponential back-off (1 s → 30 s)
- MQTT *last will* marks the node `offline` if it drops off the network
- RMS computed over a 100 ms window with DC offset removal for the analog sensors
