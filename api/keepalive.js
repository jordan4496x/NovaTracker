// Vercel Cron hits this on a schedule (see vercel.json) so the Supabase
// project sees API activity at least once a day. Supabase's free tier
// pauses a project after 7 days with no activity, which would otherwise be
// a real risk for an app that's only opened on race weekends.

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    res.status(500).json({ ok: false, error: "Missing Supabase env vars." });
    return;
  }

  try {
    const r = await fetch(`${url}/rest/v1/kv_store?select=key&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      res.status(502).json({ ok: false, error: `Supabase responded ${r.status}: ${body.slice(0, 200)}` });
      return;
    }
    res.status(200).json({ ok: true, pingedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "Unexpected error pinging Supabase." });
  }
}
