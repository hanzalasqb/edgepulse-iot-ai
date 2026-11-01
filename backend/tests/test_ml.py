import random
from datetime import datetime, timedelta

from app.iot.anomaly import RobustZScore, isolation_forest_scan
from app.iot.forecast import time_to_threshold
from app.iot.metrics import metric_spec


def test_robust_zscore_flags_spike_not_noise():
    random.seed(1)
    det = RobustZScore(window=120, threshold=3.5, min_samples=30)
    t = datetime(2026, 1, 1)
    flags = [det.update(3.0 + random.gauss(0, 0.2), t + timedelta(seconds=i))[1] for i in range(100)]
    assert sum(flags) <= 1  # gaussian noise rarely exceeds |z| 3.5
    z, is_anomaly = det.update(9.5, t + timedelta(seconds=101))
    assert is_anomaly and z > 10


def test_forecast_time_to_threshold():
    t0 = datetime(2026, 1, 1)
    times = [t0 + timedelta(minutes=i) for i in range(60)]
    values = [60 + 0.25 * i for i in range(60)]  # +15 °C per hour, reaches 74.75 after 59 min
    fc = time_to_threshold(times, values, 85, "up")
    assert fc["r2"] > 0.99 and abs(fc["slope_per_hour"] - 15) < 0.01
    assert abs(fc["hours_to_threshold"] - (85 - 74.75) / 15) < 0.01
    assert time_to_threshold(times, list(reversed(values)), 85, "up")["hours_to_threshold"] is None


def test_isolation_forest_finds_multivariate_outlier():
    random.seed(2)
    t0 = datetime(2026, 1, 1)
    rows = [{"ts": t0 + timedelta(seconds=i), "temperature": 60 + random.gauss(0, 1), "vibration": 3 + random.gauss(0, 0.2)} for i in range(200)]
    rows.append({"ts": t0 + timedelta(seconds=500), "temperature": 61, "vibration": 9})
    found = isolation_forest_scan(rows, ["temperature", "vibration"], contamination=0.01)
    assert found and found[0]["vibration"] == 9


def test_metric_levels():
    spec = metric_spec("pump", "vibration")
    assert spec.level(2.5) == "normal" and spec.level(8) == "warning" and spec.level(12) == "critical"
    assert metric_spec("cold_room", "temperature").level(-18) == "normal"
