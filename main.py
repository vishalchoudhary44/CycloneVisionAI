"""
CycloneVision AI - backend server

Serves the static HTML/CSS/JS site and exposes a JSON prediction API
that runs the real trained scikit-learn models (lat_model.pkl,
lon_model.pkl, wind_model.pkl). A browser cannot execute a scikit-learn
model on its own, so this small server is what turns the static site
into a working prediction app.
"""

from pathlib import Path
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request, send_from_directory


BASE_DIR = Path(__file__).parent
MODEL_DIR = BASE_DIR / "models"
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


# =========================================================
# MODEL FEATURES
# =========================================================

FEATURES = [
    "lat",
    "lon",
    "wind",
    "pressure",
    "prev_lat",
    "prev_lon",
    "prev_wind",
    "prev_pressure",
    "lat_change",
    "lon_change",
    "wind_change",
    "pressure_change",
    "storm_speed",
    "storm_dir",
    "month",
    "hour",
]


# =========================================================
# HELPER FUNCTIONS  (identical logic to the original app.py)
# =========================================================

def haversine_and_bearing(lat1, lon1, lat2, lon2):
    earth_radius_km = 6371.0

    lat1_rad = np.radians(lat1)
    lon1_rad = np.radians(lon1)
    lat2_rad = np.radians(lat2)
    lon2_rad = np.radians(lon2)

    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = (
        np.sin(dlat / 2) ** 2
        + np.cos(lat1_rad) * np.cos(lat2_rad) * np.sin(dlon / 2) ** 2
    )
    a = np.clip(a, 0, 1)

    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    distance_km = earth_radius_km * c

    y = np.sin(dlon) * np.cos(lat2_rad)
    x = (
        np.cos(lat1_rad) * np.sin(lat2_rad)
        - np.sin(lat1_rad) * np.cos(lat2_rad) * np.cos(dlon)
    )
    bearing_deg = (np.degrees(np.arctan2(y, x)) + 360) % 360

    return float(distance_km), float(bearing_deg)


def bearing_to_direction(bearing):
    directions = [
        "North", "North-East", "East", "South-East",
        "South", "South-West", "West", "North-West",
    ]
    index = int((bearing + 22.5) // 45) % 8
    return directions[index]


def wind_to_category(wind_knots):
    if wind_knots < 17:
        return "Depression"
    elif wind_knots < 28:
        return "Deep Depression"
    elif wind_knots < 34:
        return "Cyclonic Storm"
    elif wind_knots < 48:
        return "Severe Cyclonic Storm"
    elif wind_knots < 64:
        return "Very Severe Cyclonic Storm"
    else:
        return "Extremely Severe Cyclonic Storm"


def risk_from_wind(wind_knots):
    if wind_knots < 17:
        return 20, "LOW", "🟢"
    elif wind_knots < 28:
        return 40, "MODERATE", "🟡"
    elif wind_knots < 48:
        return 65, "HIGH", "🟠"
    elif wind_knots < 64:
        return 80, "VERY HIGH", "🔴"
    else:
        return 95, "EXTREME", "🚨"


def create_prediction_features(
    lat, lon, wind, pressure,
    prev_lat, prev_lon, prev_wind, prev_pressure,
    current_time, time_gap_hours,
):
    distance_km, bearing_deg = haversine_and_bearing(prev_lat, prev_lon, lat, lon)
    storm_speed_kmh = distance_km / time_gap_hours

    feature_row = {
        "lat": lat, "lon": lon, "wind": wind, "pressure": pressure,
        "prev_lat": prev_lat, "prev_lon": prev_lon,
        "prev_wind": prev_wind, "prev_pressure": prev_pressure,
        "lat_change": lat - prev_lat, "lon_change": lon - prev_lon,
        "wind_change": wind - prev_wind, "pressure_change": pressure - prev_pressure,
        "storm_speed": storm_speed_kmh, "storm_dir": bearing_deg,
        "month": current_time.month, "hour": current_time.hour,
    }

    return pd.DataFrame([feature_row], columns=FEATURES)


# =========================================================
# LOAD MODELS (once, at startup)
# =========================================================

def load_models():
    lat_file = MODEL_DIR / "lat_model.pkl"
    lon_file = MODEL_DIR / "lon_model.pkl"
    wind_file = MODEL_DIR / "wind_model.pkl"

    missing = [str(f) for f in (lat_file, lon_file, wind_file) if not f.exists()]
    if missing:
        raise FileNotFoundError("Missing model file(s):\n" + "\n".join(missing))

    return {
        "lat_model": joblib.load(lat_file),
        "lon_model": joblib.load(lon_file),
        "wind_model": joblib.load(wind_file),
    }


MODELS = load_models()


def get_model_features(model):
    if not hasattr(model, "feature_names_in_"):
        return None
    return list(model.feature_names_in_)


_lat_f = get_model_features(MODELS["lat_model"])
_lon_f = get_model_features(MODELS["lon_model"])
_wind_f = get_model_features(MODELS["wind_model"])

if _lat_f is not None and _lon_f is not None and _wind_f is not None:
    if not (_lat_f == _lon_f and _lat_f == _wind_f):
        raise RuntimeError("Lat, Lon and Wind models have different feature sets/order.")
    EXPECTED_FEATURES = _lat_f
else:
    EXPECTED_FEATURES = FEATURES


# =========================================================
# ROUTES
# =========================================================

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "models_loaded": True})


@app.route("/api/predict", methods=["POST"])
def predict():
    try:
        payload = request.get_json(force=True)

        prev_lat = float(payload["prev_lat"])
        prev_lon = float(payload["prev_lon"])
        prev_wind = float(payload["prev_wind"])
        prev_pressure = float(payload["prev_pressure"])

        lat = float(payload["lat"])
        lon = float(payload["lon"])
        wind = float(payload["wind"])
        pressure = float(payload["pressure"])

        time_gap_hours = float(payload.get("time_gap_hours", 6))
        current_date = payload.get("current_date")   # "YYYY-MM-DD"
        current_time_str = payload.get("current_time")  # "HH:MM"

        if current_date and current_time_str:
            current_time = datetime.strptime(
                f"{current_date} {current_time_str}", "%Y-%m-%d %H:%M"
            )
        else:
            current_time = datetime.utcnow()

    except (KeyError, ValueError, TypeError) as error:
        return jsonify({"error": f"Invalid input: {error}"}), 400

    if lat == prev_lat and lon == prev_lon:
        return jsonify({"error": "Current and previous coordinates cannot be identical."}), 400

    if time_gap_hours <= 0:
        return jsonify({"error": "Time gap must be greater than zero."}), 400

    X_input = create_prediction_features(
        lat=lat, lon=lon, wind=wind, pressure=pressure,
        prev_lat=prev_lat, prev_lon=prev_lon,
        prev_wind=prev_wind, prev_pressure=prev_pressure,
        current_time=current_time, time_gap_hours=time_gap_hours,
    )

    missing_from_app = [f for f in EXPECTED_FEATURES if f not in X_input.columns]
    if missing_from_app:
        return jsonify({"error": f"App is missing required features: {missing_from_app}"}), 500

    X_model = X_input[EXPECTED_FEATURES].copy()

    if X_model.isnull().any().any() or np.isinf(X_model.to_numpy()).any():
        return jsonify({"error": "Model input contains missing/infinite values."}), 400

    try:
        next_lat = float(MODELS["lat_model"].predict(X_model)[0])
        next_lon = float(MODELS["lon_model"].predict(X_model)[0])
        next_wind = float(MODELS["wind_model"].predict(X_model)[0])
    except Exception as error:
        return jsonify({"error": f"Prediction failed: {error}"}), 500

    if not (np.isfinite(next_lat) and np.isfinite(next_lon) and np.isfinite(next_wind)):
        return jsonify({"error": "Model produced a non-finite prediction."}), 500

    next_wind = max(0.0, next_wind)

    predicted_distance_km, predicted_bearing_deg = haversine_and_bearing(lat, lon, next_lat, next_lon)
    predicted_direction = bearing_to_direction(predicted_bearing_deg)
    predicted_category = wind_to_category(next_wind)
    risk_score, risk_level, risk_icon = risk_from_wind(next_wind)

    observed_distance_km, observed_bearing_deg = haversine_and_bearing(prev_lat, prev_lon, lat, lon)
    observed_direction = bearing_to_direction(observed_bearing_deg)
    observed_speed = observed_distance_km / time_gap_hours

    if next_wind > wind:
        intensity_trend = "Intensification likely"
    elif next_wind < wind:
        intensity_trend = "Weakening likely"
    else:
        intensity_trend = "Intensity likely to remain stable"

    return jsonify({
        "inputs": {
            "prev_lat": prev_lat, "prev_lon": prev_lon,
            "prev_wind": prev_wind, "prev_pressure": prev_pressure,
            "lat": lat, "lon": lon, "wind": wind, "pressure": pressure,
            "time_gap_hours": time_gap_hours,
        },
        "prediction": {
            "next_lat": next_lat,
            "next_lon": next_lon,
            "next_wind": next_wind,
            "predicted_category": predicted_category,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "risk_icon": risk_icon,
        },
        "predicted_movement": {
            "direction": predicted_direction,
            "bearing_deg": predicted_bearing_deg,
            "distance_km": predicted_distance_km,
            "speed_kmh": predicted_distance_km / time_gap_hours,
        },
        "observed_movement": {
            "direction": observed_direction,
            "bearing_deg": observed_bearing_deg,
            "distance_km": observed_distance_km,
            "speed_kmh": observed_speed,
        },
        "intensity_trend": intensity_trend,
        "model_input_features": X_model.iloc[0].to_dict(),
        "expected_features": EXPECTED_FEATURES,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
