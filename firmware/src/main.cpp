/*
 * EdgePulse ESP32 sensor node (pump profile)
 * ------------------------------------------
 * - DS18B20  motor temperature        (GPIO 4, 4.7k pull-up)
 * - ADXL335  vibration, X axis analog (GPIO 34) -> RMS -> mm/s (calibrate VIB_MM_S_PER_G)
 * - ACS712   motor current, analog    (GPIO 35) -> RMS amps   (20 A module: 100 mV/A)
 * - Relay    pump contactor           (GPIO 26, active HIGH)
 *
 * Publishes  edgepulse/<id>/telemetry   {"key": "...", "values": {...}}
 * Subscribes edgepulse/<id>/cmd         {"command_id": 1, "name": "set_relay", "payload": {"on": false}}
 * Acks       edgepulse/<id>/ack         {"key": "...", "command_id": 1, "ok": true}
 * Status     edgepulse/<id>/status      "online" / "offline" (retained, offline is the MQTT last will)
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "secrets.h"

constexpr uint8_t PIN_TEMP = 4;
constexpr uint8_t PIN_VIBRATION = 34;
constexpr uint8_t PIN_CURRENT = 35;
constexpr uint8_t PIN_RELAY = 26;

constexpr float ADC_VREF = 3.3f;
constexpr float ADC_MAX = 4095.0f;
constexpr float ADXL335_V_PER_G = 0.330f;   // datasheet sensitivity at 3.3 V supply
constexpr float VIB_MM_S_PER_G = 15.6f;     // calibrate against a reference vibration meter
constexpr float ACS712_V_PER_A = 0.100f;    // 20 A variant (behind a 5V->3.3V divider: adjust)
constexpr int RMS_SAMPLES = 400;

OneWire oneWire(PIN_TEMP);
DallasTemperature tempSensor(&oneWire);
WiFiClient net;
PubSubClient mqtt(net);

String topicBase = String("edgepulse/") + DEVICE_ID;
uint32_t intervalMs = 5000;
uint32_t lastPublish = 0;
uint32_t reconnectDelay = 1000;
bool relayOn = true;

// Mean-removed RMS of an analog channel, returned in volts.
float acRmsVolts(uint8_t pin) {
  static uint16_t samples[RMS_SAMPLES];
  double mean = 0;
  for (int i = 0; i < RMS_SAMPLES; i++) {
    samples[i] = analogRead(pin);
    mean += samples[i];
    delayMicroseconds(250);  // ~4 kHz sampling window of 100 ms
  }
  mean /= RMS_SAMPLES;
  double sumSq = 0;
  for (int i = 0; i < RMS_SAMPLES; i++) {
    double v = (samples[i] - mean) * ADC_VREF / ADC_MAX;
    sumSq += v * v;
  }
  return sqrt(sumSq / RMS_SAMPLES);
}

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
}

void publishAck(long commandId, bool ok) {
  JsonDocument doc;
  doc["key"] = DEVICE_KEY;
  doc["command_id"] = commandId;
  doc["ok"] = ok;
  char buf[160];
  size_t n = serializeJson(doc, buf);
  mqtt.publish((topicBase + "/ack").c_str(), (const uint8_t*)buf, n, false);
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  long id = doc["command_id"] | -1L;
  const char* name = doc["name"] | "";
  bool ok = true;
  if (strcmp(name, "set_relay") == 0) {
    setRelay(doc["payload"]["on"] | relayOn);
  } else if (strcmp(name, "set_interval") == 0) {
    int seconds = doc["payload"]["seconds"] | 5;
    intervalMs = constrain(seconds, 1, 3600) * 1000UL;
  } else if (strcmp(name, "reboot") == 0) {
    publishAck(id, true);
    delay(200);
    ESP.restart();
  } else {
    ok = false;
  }
  publishAck(id, ok);
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
    Serial.print('.');
  }
  Serial.printf("\nWiFi %s, IP %s\n", WiFi.status() == WL_CONNECTED ? "connected" : "failed", WiFi.localIP().toString().c_str());
}

bool ensureMqtt() {
  if (mqtt.connected()) return true;
  String statusTopic = topicBase + "/status";
  const char* user = strlen(MQTT_USER) ? MQTT_USER : nullptr;  // anonymous when no credentials are configured
  const char* pass = strlen(MQTT_PASS) ? MQTT_PASS : nullptr;
  bool ok = mqtt.connect(DEVICE_ID, user, pass, statusTopic.c_str(), 1, true, "offline");
  if (ok) {
    mqtt.publish(statusTopic.c_str(), "online", true);
    mqtt.subscribe((topicBase + "/cmd").c_str(), 1);
    reconnectDelay = 1000;
    Serial.println("MQTT connected");
  } else {
    Serial.printf("MQTT failed (state %d), retry in %lu ms\n", mqtt.state(), reconnectDelay);
    delay(reconnectDelay);
    reconnectDelay = min<uint32_t>(reconnectDelay * 2, 30000);  // exponential back-off
  }
  return ok;
}

void publishTelemetry() {
  tempSensor.requestTemperatures();
  float temperature = tempSensor.getTempCByIndex(0);
  float vibration = acRmsVolts(PIN_VIBRATION) / ADXL335_V_PER_G * VIB_MM_S_PER_G;
  float current = acRmsVolts(PIN_CURRENT) / ACS712_V_PER_A;

  JsonDocument doc;
  doc["key"] = DEVICE_KEY;
  JsonObject values = doc["values"].to<JsonObject>();
  if (temperature > -100) values["temperature"] = serialized(String(temperature, 2));
  values["vibration"] = serialized(String(vibration, 3));
  values["current"] = serialized(String(relayOn ? current : 0.0f, 2));

  char buf[256];
  size_t n = serializeJson(doc, buf);
  bool sent = mqtt.publish((topicBase + "/telemetry").c_str(), (const uint8_t*)buf, n, false);
  Serial.printf("%s %s\n", sent ? "->" : "!!", buf);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT);
  setRelay(true);
  analogReadResolution(12);
  tempSensor.begin();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  ensureWifi();
}

void loop() {
  ensureWifi();
  if (!ensureMqtt()) return;
  mqtt.loop();
  if (millis() - lastPublish >= intervalMs) {
    lastPublish = millis();
    publishTelemetry();
  }
}
