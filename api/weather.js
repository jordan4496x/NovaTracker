// Vercel serverless function. Given a lat/lon and a run's date/time, looks
// up temperature/humidity/pressure from Open-Meteo (forecast API for
// recent/current/near-future dates, archive API for older historical dates)
// and computes Density Altitude + Water Grains server-side, since weather
// APIs don't return those drag-racing-specific values directly.

const HOURLY_PARAMS = "temperature_2m,relative_humidity_2m,surface_pressure";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { lat, lon, date, time, times } = req.body || {};
  if (typeof lat !== "number" || typeof lon !== "number" || !date) {
    res.status(400).json({ error: "Missing location or date." });
    return;
  }

  try {
    let data = await fetchHourly("https://api.open-meteo.com/v1/forecast", lat, lon, date);
    let source = "forecast";
    if (!data) {
      data = await fetchHourly("https://archive-api.open-meteo.com/v1/archive", lat, lon, date);
      source = "archive";
    }
    if (!data) {
      res.status(502).json({ error: "Weather service has no data for that date/location." });
      return;
    }

    // Batch mode: one Open-Meteo call reused for every requested time that
    // day (used by the backfill job so it doesn't hit the API once per run).
    if (Array.isArray(times)) {
      const results = times.map((t) => {
        const point = pointAt(data, date, t);
        return point ? { time: t, ...point, source } : { time: t, error: "No data for that hour." };
      });
      res.status(200).json({ results, source });
      return;
    }

    const point = pointAt(data, date, time);
    if (!point) {
      res.status(502).json({ error: "Weather service returned incomplete data for that date/location." });
      return;
    }
    res.status(200).json({ ...point, source });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Unexpected error fetching weather." });
  }
}

function pointAt(data, date, time) {
  const idx = nearestHourIndex(data.hourly.time, date, time);
  const tempF = data.hourly.temperature_2m[idx];
  const humidityPct = data.hourly.relative_humidity_2m[idx];
  const pressureHpa = data.hourly.surface_pressure[idx];
  const elevationM = data.elevation;

  if ([tempF, humidityPct, pressureHpa, elevationM].some((v) => v == null || isNaN(v))) return null;

  const { densityAltitudeFt, grains } = computeDaAndGrains({ tempF, humidityPct, pressureHpa, elevationM });
  return {
    temp: Math.round(tempF),
    humidity: Math.round(humidityPct),
    waterGrains: Math.round(grains),
    da: Math.round(densityAltitudeFt),
    matchedTime: data.hourly.time[idx],
  };
}

async function fetchHourly(baseUrl, lat, lon, date) {
  const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${HOURLY_PARAMS}&temperature_unit=fahrenheit&timezone=auto&start_date=${date}&end_date=${date}`;
  const r = await fetch(url);
  const body = await r.json().catch(() => null);
  if (!r.ok || !body || body.error || !body.hourly) return null;
  return body;
}

function nearestHourIndex(hourlyTimes, date, time) {
  const [h, m] = (time && /^\d{2}:\d{2}$/.test(time) ? time : "12:00").split(":").map(Number);
  const roundedHour = m >= 30 ? (h + 1) % 24 : h;
  const label = `${date}T${String(roundedHour).padStart(2, "0")}:00`;
  const idx = hourlyTimes.indexOf(label);
  return idx === -1 ? Math.floor(hourlyTimes.length / 2) : idx;
}

// Standard drag-racing DA formula (pressure altitude + 120ft per °F above
// the ISA standard temp for that elevation) and a Magnus-Tetens psychrometric
// calc for grains of water per pound of dry air. These are estimates from
// modeled weather data, not a certified on-site instrument reading.
function computeDaAndGrains({ tempF, humidityPct, pressureHpa, elevationM }) {
  const elevationFt = elevationM * 3.28084;
  const pressureInHg = pressureHpa * 0.0295299830714;
  const pressureAltitudeFt = elevationFt + (29.92 - pressureInHg) * 1000;
  const isaTempF = 59 - 3.566 * (elevationFt / 1000);
  const densityAltitudeFt = pressureAltitudeFt + 120 * (tempF - isaTempF);

  const tempC = (tempF - 32) * (5 / 9);
  const satVaporPressureHpa = 6.1094 * Math.exp((17.625 * tempC) / (tempC + 243.04));
  const vaporPressureHpa = satVaporPressureHpa * (humidityPct / 100);
  const humidityRatio = (0.62198 * vaporPressureHpa) / (pressureHpa - vaporPressureHpa);
  const grains = humidityRatio * 7000;

  return { densityAltitudeFt, grains };
}
