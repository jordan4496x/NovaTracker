// Talks to our own /api/storage route (server-side, using a secret Supabase
// service role key) instead of hitting Supabase directly from the browser —
// the browser never sees a Supabase key at all. Mimics the original artifact
// window.storage API so the rest of the app doesn't need to change:
// get(key) -> { key, value } | null, set(key, value).

export const storage = {
  async get(key) {
    try {
      const res = await fetch(`/api/storage?key=${encodeURIComponent(key)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.value == null) return null;
      return { key, value: JSON.stringify(data.value) };
    } catch (e) {
      console.error("storage.get error:", e);
      return null;
    }
  },

  async set(key, value) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    try {
      const res = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: parsed }),
      });
      if (!res.ok) {
        console.error("storage.set error:", await res.text().catch(() => ""));
        return null;
      }
      return { key, value };
    } catch (e) {
      console.error("storage.set error:", e);
      return null;
    }
  },

  // No more realtime websocket — that required exposing a Supabase key to
  // the browser, which is exactly what we removed. Polls instead: checks in
  // periodically, and immediately when the tab regains focus, so another
  // device's changes still show up without a manual restart.
  subscribe(onChange) {
    let stopped = false;
    const tick = () => {
      if (stopped || document.hidden) return;
      onChange();
    };
    const interval = setInterval(tick, 20000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  },
};
