// Vercel serverless function. All reads/writes to the kv_store table go
// through here using the Supabase SERVICE ROLE key, which stays server-side
// and bypasses Row Level Security. The browser never talks to Supabase (or
// sees any Supabase key) directly — RLS on kv_store denies public/anon
// access entirely, so this route is the only way in.
//
// GET  /api/storage?key=novalog-runs  -> { key, value }  (value is null if not found)
// POST /api/storage  { key, value }   -> { key, value }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: "Missing Supabase server config (SUPABASE_SERVICE_ROLE_KEY)." });
    return;
  }

  const headers = {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    "content-type": "application/json",
  };

  if (req.method === "GET") {
    const key = req.query?.key;
    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "Missing key." });
      return;
    }
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
        { headers }
      );
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        res.status(502).json({ error: `Supabase error ${r.status}: ${body.slice(0, 300)}` });
        return;
      }
      const rows = await r.json();
      res.status(200).json({ key, value: rows.length ? rows[0].value : null });
    } catch (err) {
      res.status(500).json({ error: err?.message || "Unexpected error reading storage." });
    }
    return;
  }

  if (req.method === "POST") {
    const { key, value } = req.body || {};
    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "Missing key." });
      return;
    }
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST",
        headers: { ...headers, prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        res.status(502).json({ error: `Supabase error ${r.status}: ${body.slice(0, 300)}` });
        return;
      }
      res.status(200).json({ key, value });
    } catch (err) {
      res.status(500).json({ error: err?.message || "Unexpected error writing storage." });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
