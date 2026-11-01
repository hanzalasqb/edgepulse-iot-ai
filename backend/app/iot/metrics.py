"""Metric catalogue per device type: units and alarm limits (low/high warning and critical)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class MetricSpec:
    key: str
    label: str
    unit: str
    warn_high: float | None = None
    crit_high: float | None = None
    warn_low: float | None = None
    crit_low: float | None = None

    def level(self, value: float) -> str:
        if (self.crit_high is not None and value >= self.crit_high) or (self.crit_low is not None and value <= self.crit_low):
            return "critical"
        if (self.warn_high is not None and value >= self.warn_high) or (self.warn_low is not None and value <= self.warn_low):
            return "warning"
        return "normal"


DEVICE_TYPES: dict[str, dict] = {
    "pump": {
        "label": "Industrial pump",
        "metrics": [
            MetricSpec("temperature", "Motor temperature", "°C", warn_high=75, crit_high=85),
            # ISO 10816-3 style velocity zones (mm/s RMS)
            MetricSpec("vibration", "Vibration", "mm/s", warn_high=7.1, crit_high=11.2),
            MetricSpec("current", "Motor current", "A", warn_high=13, crit_high=15),
        ],
    },
    "cold_room": {
        "label": "Cold room",
        "metrics": [
            MetricSpec("temperature", "Air temperature", "°C", warn_high=-12, crit_high=-8),
            MetricSpec("humidity", "Humidity", "%", warn_high=90, crit_high=95),
            MetricSpec("current", "Compressor current", "A", warn_high=18, crit_high=22),
        ],
    },
    "hvac": {
        "label": "HVAC unit",
        "metrics": [
            MetricSpec("temperature", "Supply air temperature", "°C", warn_high=26, crit_high=30, warn_low=12, crit_low=8),
            MetricSpec("humidity", "Humidity", "%", warn_high=70, crit_high=80),
            MetricSpec("current", "Fan current", "A", warn_high=9, crit_high=11),
        ],
    },
    "solar_inverter": {
        "label": "Solar inverter",
        "metrics": [
            MetricSpec("voltage", "Grid voltage", "V", warn_high=250, crit_high=255, warn_low=210, crit_low=200),
            MetricSpec("power", "Output power", "kW", warn_low=None),
            MetricSpec("temperature", "Heatsink temperature", "°C", warn_high=70, crit_high=80),
        ],
    },
    "greenhouse": {
        "label": "Greenhouse controller",
        "metrics": [
            MetricSpec("temperature", "Air temperature", "°C", warn_high=32, crit_high=36, warn_low=12, crit_low=8),
            MetricSpec("humidity", "Humidity", "%", warn_high=85, crit_high=92, warn_low=40, crit_low=30),
            MetricSpec("soil_moisture", "Soil moisture", "%", warn_low=25, crit_low=15),
        ],
    },
}


def metric_spec(device_type: str, metric: str) -> MetricSpec | None:
    for spec in DEVICE_TYPES.get(device_type, {}).get("metrics", []):
        if spec.key == metric:
            return spec
    return None


def specs_as_dict(device_type: str) -> list[dict]:
    return [spec.__dict__ for spec in DEVICE_TYPES.get(device_type, {}).get("metrics", [])]
