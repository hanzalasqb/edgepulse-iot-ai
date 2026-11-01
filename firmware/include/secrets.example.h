// Copy to secrets.h (git-ignored) and fill in your values.
#pragma once

#define WIFI_SSID "your-wifi"
#define WIFI_PASSWORD "your-wifi-password"

#define MQTT_HOST "192.168.1.50"   // machine running docker compose (Mosquitto)
#define MQTT_PORT 1883
#define MQTT_USER ""                // set when the broker has authentication enabled
#define MQTT_PASS ""

#define DEVICE_ID "pump-01"         // must exist in EdgePulse (Devices -> Provision)
#define DEVICE_KEY "ep_xxxxxxxxxxxxxxxxxxxx"  // key returned once when the device was provisioned
