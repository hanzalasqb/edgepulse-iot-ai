"""Anomaly detection.

* ``RobustZScore`` - streaming, per metric. Uses the modified z-score (Iglewicz & Hoaglin) on a
  rolling window: z = 0.6745 * (x - median) / MAD. It is robust to the outliers it is hunting.
* ``isolation_forest_scan`` - batch, multivariate. Finds readings whose *combination* of metrics is
  unusual, even when every single metric is within its limits.
"""
from collections import deque
from datetime import datetime

import numpy as np

ANOMALY_Z = 4.0  # modified z-score above which a reading is flagged (3.5 is the textbook value; 4.0 = fewer false alarms)


class RobustZScore:
    def __init__(self, window: int = 120, threshold: float = ANOMALY_Z, min_samples: int = 30):
        self.values: deque[float] = deque(maxlen=window)
        self.times: deque[datetime] = deque(maxlen=window)
        self.threshold = threshold
        self.min_samples = min_samples

    def score(self, value: float) -> float | None:
        if len(self.values) < self.min_samples:
            return None
        data = np.fromiter(self.values, dtype=float)
        median = float(np.median(data))
        mad = float(np.median(np.abs(data - median)))
        if mad < 1e-9:
            mad = float(np.mean(np.abs(data - median))) or 1e-9
        return 0.6745 * (value - median) / mad

    def update(self, value: float, ts: datetime) -> tuple[float | None, bool]:
        """Score the new value against history, then add it to the window."""
        z = self.score(value)
        self.values.append(value)
        self.times.append(ts)
        return z, z is not None and abs(z) >= self.threshold

    def baseline(self) -> float | None:
        return float(np.median(np.fromiter(self.values, dtype=float))) if self.values else None


def isolation_forest_scan(rows: list[dict], metrics: list[str], contamination: float = 0.05) -> list[dict]:
    """rows: [{"ts": datetime, "<metric>": value, ...}]. Returns the anomalous rows with a score."""
    from sklearn.ensemble import IsolationForest  # imported lazily: heavy dependency

    complete = [r for r in rows if all(m in r for m in metrics)]
    if len(complete) < 30:
        return []
    matrix = np.array([[r[m] for m in metrics] for r in complete], dtype=float)
    std = matrix.std(axis=0)
    std[std == 0] = 1
    normalised = (matrix - matrix.mean(axis=0)) / std
    model = IsolationForest(n_estimators=150, contamination=contamination, random_state=42).fit(normalised)
    scores = -model.score_samples(normalised)  # higher = more anomalous
    labels = model.predict(normalised)
    out = [
        {"ts": complete[i]["ts"], "score": round(float(scores[i]), 3), **{m: complete[i][m] for m in metrics}}
        for i in range(len(complete)) if labels[i] == -1
    ]
    return sorted(out, key=lambda r: -r["score"])
