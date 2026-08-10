// Vercel serverless function. Resolves a place name (or US zip code) to
// lat/lon/elevation so weather can be looked up for a track. No API key
// needed — Open-Meteo's geocoding is free, and US zips go through
// Zippopotam.us (also free, no key).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { query } = req.body || {};
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (!trimmed) {
    res.status(400).json({ error: "No location given." });
    return;
  }

  try {
    if (/^\d{5}$/.test(trimmed)) {
      const zipRes = await fetch(`https://api.zippopotam.us/us/${trimmed}`);
      if (zipRes.ok) {
        const data = await zipRes.json();
        const place = data.places && data.places[0];
        if (place) {
          const lat = parseFloat(place.latitude);
          const lon = parseFloat(place.longitude);
          const elevation = await fetchElevation(lat, lon);
          res.status(200).json({
            lat,
            lon,
            elevation,
            label: `${place["place name"]}, ${place["state abbreviation"]} ${trimmed}`,
          });
          return;
        }
      }
      res.status(404).json({ error: `Couldn't find zip code ${trimmed}.` });
      return;
    }

    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`
    );
    if (!geoRes.ok) {
      res.status(502).json({ error: `Geocoding service error (${geoRes.status}).` });
      return;
    }
    const data = await geoRes.json();
    const match = data.results && data.results[0];
    if (!match) {
      res.status(404).json({ error: `Couldn't find "${trimmed}". Try a nearby city, state, or zip code instead.` });
      return;
    }
    const label = [match.name, match.admin1, match.country].filter(Boolean).join(", ");
    res.status(200).json({ lat: match.latitude, lon: match.longitude, elevation: match.elevation, label });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Unexpected error resolving that location." });
  }
}

async function fetchElevation(lat, lon) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.elevation) ? d.elevation[0] : null;
  } catch {
    return null;
  }
}
