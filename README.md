# CycloneVision AI — Website

A real HTML/CSS/JS website for your cyclone track & intensity prediction models.

## Why there's a small backend

Your models (`lat_model.pkl`, `lon_model.pkl`, `wind_model.pkl`) are trained
scikit-learn models. A browser cannot execute a `.pkl` file directly — there's
no scikit-learn runtime in JavaScript. So this project is:

- **Frontend**: plain HTML + CSS + JavaScript (`static/index.html`, `style.css`,
  `script.js`) — this is the actual "website" people see and interact with.
- **Backend**: a tiny Flask server (`server.py`) that loads your models once at
  startup and exposes one JSON endpoint, `/api/predict`, which the frontend
  calls with `fetch()`. The feature engineering (haversine distance, bearing,
  changes, storm speed/direction, month/hour) is the exact same logic as your
  original `app.py`.

Flask also serves the HTML/CSS/JS files directly, so there's only one server
to run and no CORS setup needed.

## Folder structure

```
cyclonevision_web/
├── server.py              # Flask backend + API
├── requirements.txt
├── models/
│   ├── lat_model.pkl
│   ├── lon_model.pkl
│   ├── wind_model.pkl
│   └── model_features.pkl
└── static/
    ├── index.html         # the website
    ├── style.css          # dark, glass-panel theme
    └── script.js          # form handling, API calls, map rendering
```

## Run it

```bash
cd cyclonevision_web
pip install -r requirements.txt
python server.py
```

Open **http://localhost:5000** in your browser.

## What the site does

1. **Prediction Settings** — time gap (3h/6h), observation date & time.
2. **Data Entry** — previous + current observation (lat, lon, wind, pressure).
3. Click **Predict Next Cyclone Position and Intensity** → the page calls
   `/api/predict`, which runs your real models and returns:
   - Predicted lat/lon/wind + severity category
   - Predicted movement (direction, bearing, distance, speed)
   - Observed movement (same, from your two inputs)
   - A color-coded risk banner (green → yellow → orange → red → crimson)
   - An interactive dark-themed map (Leaflet + CARTO dark tiles, no API key
     needed) showing Previous → Current → Predicted track
   - A decision-support summary table
   - A collapsible view of the exact feature vector sent to the models

## Using a real map API key (Mapbox)

By default the map uses free, keyless OpenStreetMap tiles with a CSS filter
that fakes a dark theme. If you'd rather use Mapbox's native dark map style:

1. Create a free account at https://account.mapbox.com/auth/signup/
   (no credit card needed for the free tier — 50,000 map loads/month free).
2. Go to https://account.mapbox.com/access-tokens/ and copy your
   **Default public token** (starts with `pk.`).
3. Open `static/script.js` and paste it into the `MAPBOX_TOKEN` constant
   near the top of the file:
   ```js
   const MAPBOX_TOKEN = "pk.your_token_here";
   ```
4. Save, restart `python server.py`, and hard-refresh the page
   (Ctrl+Shift+R). The map will now use Mapbox's `dark-v11` style directly —
   no CSS filter trick needed.

Leave `MAPBOX_TOKEN` as an empty string `""` to keep using the free
OpenStreetMap fallback; the site works either way.

**Never commit a real Mapbox token to a public GitHub repo** — anyone can
use it against your account's free-tier quota. For a public deployment,
consider loading it from an environment variable / server-rendered value
instead of hardcoding it in the JS file.



Any host that can run a small Python/Flask app works:

- **Render.com / Railway.app** — connect your GitHub repo, set the start
  command to `python server.py` (or `gunicorn server:app` for production),
  and it'll give you a public URL.
- **Hugging Face Spaces** (Docker or Gradio-adjacent "Flask" template).
- **A VM** — run `pip install gunicorn` then
  `gunicorn -w 2 -b 0.0.0.0:80 server:app`.

For production, replace `python server.py` with a real WSGI server such as
`gunicorn` (Flask's built-in server prints a warning that it's dev-only).
