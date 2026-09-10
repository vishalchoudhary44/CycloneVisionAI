// ==========================================================
// CycloneVision AI — frontend logic
// ==========================================================

const API_BASE = ""; // same-origin (Flask serves both site + API)

// -----------------------------------------------------------------
// OPTIONAL: paste a free Mapbox public token below to use Mapbox's
// native dark map style instead of the keyless OpenStreetMap tiles.
//
// How to get one (free, no credit card required for the free tier):
//   1. Go to https://account.mapbox.com/auth/signup/ and create an account.
//   2. Go to https://account.mapbox.com/access-tokens/
//   3. Copy the "Default public token" (starts with "pk.")
//   4. Paste it between the quotes below.
//
// Leave it as an empty string "" to keep using the free, keyless
// OpenStreetMap tiles (with a CSS dark-mode filter applied) — the
// site works either way.
// -----------------------------------------------------------------
const MAPBOX_TOKEN = "";

let map = null;
let mapLayers = [];

// ---------------------------------------------------------
// Init defaults (date/time fields) + health check
// ---------------------------------------------------------
function initDefaults() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 16);

  document.getElementById("current_date").value = dateStr;
  document.getElementById("current_time").value = timeStr;
}

async function checkHealth() {
  const pill = document.getElementById("model-status-pill");
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    if (data.models_loaded) {
      pill.innerHTML = `<span class="status-dot"></span> All trained models loaded`;
      pill.classList.add("ready");
      return;
    }
    throw new Error("models not loaded");
  } catch (err) {
    pill.innerHTML = `⚠️ API not reachable — start server.py`;
    pill.classList.add("error");
  }
}

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function fmtDelta(value, unit = "") {
  if (value > 0) return { text: `+${value.toFixed(2)}${unit}`, dir: "up" };
  if (value < 0) return { text: `${value.toFixed(2)}${unit}`, dir: "down" };
  return { text: `0.00${unit}`, dir: "flat" };
}

function riskCssClass(level) {
  return {
    LOW: "risk-low",
    MODERATE: "risk-moderate",
    HIGH: "risk-high",
    "VERY HIGH": "risk-veryhigh",
    EXTREME: "risk-extreme",
  }[level] || "risk-low";
}

function riskCopy(level) {
  if (level === "EXTREME" || level === "VERY HIGH") {
    return "Predicted intensity requires expert validation.";
  }
  if (level === "HIGH") {
    return "Cyclone may strengthen. Continue monitoring.";
  }
  return "Continue monitoring official weather updates.";
}

function metricCardHTML({ label, value, delta, deltaDir }) {
  let deltaHtml = "";
  if (delta !== undefined) {
    const cls = { up: "metric-delta-up", down: "metric-delta-down", flat: "metric-delta-flat" }[deltaDir] || "metric-delta-flat";
    deltaHtml = `<div class="${cls}">${delta}</div>`;
  }
  return `
    <div class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      ${deltaHtml}
    </div>
  `;
}

function renderMetricGrid(elementId, items) {
  document.getElementById(elementId).innerHTML = items.map(metricCardHTML).join("");
}

// ---------------------------------------------------------
// Map rendering
// ---------------------------------------------------------
function renderMap(prevLat, prevLon, lat, lon, nextLat, nextLon, timeGapHours) {
  if (!map) {
    map = L.map("track-map", { zoomControl: true, attributionControl: true });

    if (MAPBOX_TOKEN && MAPBOX_TOKEN.trim() !== "") {
      // Native Mapbox dark style — requires a free Mapbox account/token.
      L.tileLayer(
        `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}{r}?access_token=${MAPBOX_TOKEN}`,
        {
          attribution:
            '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          tileSize: 512,
          zoomOffset: -1,
          maxZoom: 19,
        }
      ).addTo(map);
      document.getElementById("track-map").classList.remove("fallback-dark-tiles");
    } else {
      // Free, keyless fallback: standard OpenStreetMap tiles with a CSS
      // filter (see style.css) applied to fake a dark theme.
      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          subdomains: "abc",
          maxZoom: 19,
        }
      ).addTo(map);
      document.getElementById("track-map").classList.add("fallback-dark-tiles");
    }
  }

  // clear previous layers
  mapLayers.forEach((l) => map.removeLayer(l));
  mapLayers = [];

  const prevPoint = [prevLat, prevLon];
  const currPoint = [lat, lon];
  const nextPoint = [nextLat, nextLon];

  const line = L.polyline([prevPoint, currPoint, nextPoint], {
    color: "#DC2626",
    weight: 4,
    opacity: 0.9,
  }).addTo(map);
  mapLayers.push(line);

  const makeMarker = (point, color, radius, label) => {
    const m = L.circleMarker(point, {
      radius,
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(map);
    m.bindTooltip(label, { direction: "top" });
    mapLayers.push(m);
  };

  makeMarker(prevPoint, "#1E88E5", 9, "Previous Observation");
  makeMarker(currPoint, "#FFC107", 10, "Current Observation");
  makeMarker(nextPoint, "#DC2626", 12, `AI Prediction +${timeGapHours}h`);

  const bounds = L.latLngBounds([prevPoint, currPoint, nextPoint]);
  map.fitBounds(bounds, { padding: [60, 60] });
}

function renderLegend(timeGapHours) {
  document.getElementById("legend-row").innerHTML = `
    <div class="legend-chip"><span class="dot" style="background:#1E88E5;"></span>Previous observed location</div>
    <div class="legend-chip"><span class="dot" style="background:#FFC107;"></span>Current observed location</div>
    <div class="legend-chip"><span class="dot" style="background:#DC2626;"></span>AI prediction after ${timeGapHours} hours</div>
  `;
}

// ---------------------------------------------------------
// Form submit -> call API -> render everything
// ---------------------------------------------------------
async function handleSubmit(event) {
  event.preventDefault();

  const errorBox = document.getElementById("form-error");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";

  const btn = document.getElementById("predict-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Predicting…";

  const payload = {
    prev_lat: parseFloat(document.getElementById("prev_lat").value),
    prev_lon: parseFloat(document.getElementById("prev_lon").value),
    prev_wind: parseFloat(document.getElementById("prev_wind").value),
    prev_pressure: parseFloat(document.getElementById("prev_pressure").value),
    lat: parseFloat(document.getElementById("lat").value),
    lon: parseFloat(document.getElementById("lon").value),
    wind: parseFloat(document.getElementById("wind").value),
    pressure: parseFloat(document.getElementById("pressure").value),
    time_gap_hours: parseFloat(document.getElementById("time_gap_hours").value),
    current_date: document.getElementById("current_date").value,
    current_time: document.getElementById("current_time").value,
  };

  try {
    const res = await fetch(`${API_BASE}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Prediction failed.");
    }

    renderResults(payload, data);
  } catch (err) {
    errorBox.textContent = `⚠️ ${err.message}`;
    errorBox.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔮 Predict Next Cyclone Position and Intensity";
  }
}

function renderResults(inputs, data) {
  document.getElementById("initial-state").classList.add("hidden");
  document.getElementById("results").classList.remove("hidden");

  const { prediction, predicted_movement, observed_movement, intensity_trend } = data;

  // ---- Risk banner ----
  document.getElementById("risk-banner").className = `risk-banner ${riskCssClass(prediction.risk_level)}`;
  document.getElementById("risk-icon").textContent = prediction.risk_icon;
  document.getElementById("risk-title").textContent = `${prediction.risk_level} RISK`;
  document.getElementById("risk-sub").textContent = riskCopy(prediction.risk_level);

  // ---- Prediction metrics ----
  const dLat = fmtDelta(prediction.next_lat - inputs.lat, "°");
  const dLon = fmtDelta(prediction.next_lon - inputs.lon, "°");
  const dWind = fmtDelta(prediction.next_wind - inputs.wind, " kt");

  renderMetricGrid("prediction-metrics", [
    { label: "Predicted Latitude", value: `${prediction.next_lat.toFixed(2)}°N`, delta: dLat.text, deltaDir: dLat.dir },
    { label: "Predicted Longitude", value: `${prediction.next_lon.toFixed(2)}°E`, delta: dLon.text, deltaDir: dLon.dir },
    { label: "Predicted Wind", value: `${prediction.next_wind.toFixed(1)} kt`, delta: dWind.text, deltaDir: dWind.dir },
    { label: "Predicted Severity", value: prediction.predicted_category },
  ]);

  // ---- Predicted movement ----
  renderMetricGrid("predicted-movement-metrics", [
    { label: "Next Direction", value: predicted_movement.direction },
    { label: "Bearing", value: `${predicted_movement.bearing_deg.toFixed(1)}°` },
    { label: "Distance in Next Period", value: `${predicted_movement.distance_km.toFixed(1)} km` },
    { label: "Predicted Translation Speed", value: `${predicted_movement.speed_kmh.toFixed(1)} km/h` },
  ]);

  // ---- Observed movement ----
  renderMetricGrid("observed-movement-metrics", [
    { label: "Current Direction", value: observed_movement.direction },
    { label: "Current Bearing", value: `${observed_movement.bearing_deg.toFixed(1)}°` },
    { label: "Distance Travelled", value: `${observed_movement.distance_km.toFixed(1)} km` },
    { label: "Translation Speed", value: `${observed_movement.speed_kmh.toFixed(1)} km/h` },
  ]);

  // ---- Map ----
  renderMap(
    inputs.prev_lat, inputs.prev_lon,
    inputs.lat, inputs.lon,
    prediction.next_lat, prediction.next_lon,
    inputs.time_gap_hours
  );
  renderLegend(inputs.time_gap_hours);

  // ---- Summary table ----
  const rows = [
    ["Forecast Horizon", `Next ${inputs.time_gap_hours} hours`],
    ["Current Movement Direction", observed_movement.direction],
    ["Predicted Movement Direction", predicted_movement.direction],
    ["Predicted Intensity Trend", intensity_trend],
    ["Predicted Category", prediction.predicted_category],
    ["Prototype Risk Level", prediction.risk_level],
    ["Prototype Risk Score", `${prediction.risk_score}/100`],
  ];
  document.querySelector("#summary-table tbody").innerHTML = rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join("");

  // ---- Feature JSON ----
  document.getElementById("feature-json").textContent = JSON.stringify(
    data.model_input_features,
    null,
    2
  );

  // scroll to results
  document.getElementById("result-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------
// Boot
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initDefaults();
  checkHealth();
  document.getElementById("prediction-form").addEventListener("submit", handleSubmit);
});
