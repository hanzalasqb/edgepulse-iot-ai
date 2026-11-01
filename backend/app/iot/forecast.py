"""Predictive maintenance: fit a linear trend and estimate the time until a limit is crossed."""
from datetime import datetime

import numpy as np


def time_to_threshold(times: list[datetime], values: list[float], threshold: float, direction: str = "up") -> dict | None:
    """Least-squares trend over the samples.

    Returns slope per hour, R² and the hours until ``threshold`` is reached when the trend
    is heading towards it.
    """
    if len(values) < 10:
        return None
    t0 = times[0]
    x = np.array([(t - t0).total_seconds() / 3600 for t in times])
    y = np.array(values, dtype=float)
    if np.ptp(x) == 0:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    predicted = slope * x + intercept
    ss_res = float(np.sum((y - predicted) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-9
    r2 = max(0.0, 1 - ss_res / ss_tot)
    current = float(predicted[-1])
    hours = None
    heading = (direction == "up" and slope > 0 and current < threshold) or (direction == "down" and slope < 0 and current > threshold)
    if heading:
        hours = (threshold - current) / slope
    return {"slope_per_hour": round(float(slope), 4), "r2": round(r2, 3), "current_trend_value": round(current, 3),
            "threshold": threshold, "hours_to_threshold": round(hours, 2) if hours is not None else None}
