import { supabase } from "./supabaseClient";

// Mimics the original artifact window.storage API so the rest of the app
// doesn't need to change: get(key) -> { key, value } | null, set(key, value).
// Everything is stored in a single "kv_store" table: key text primary key, value jsonb.

export const storage = {
  async get(key) {
    const { data, error } = await supabase.from("kv_store").select("value").eq("key", key).maybeSingle();
    if (error) {
      console.error("storage.get error:", error);
      return null;
    }
    if (!data) return null;
    return { key, value: JSON.stringify(data.value) };
  },

  async set(key, value) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const { error } = await supabase.from("kv_store").upsert({ key, value: parsed, updated_at: new Date().toISOString() });
    if (error) {
      console.error("storage.set error:", error);
      return null;
    }
    return { key, value };
  },

  // Calls onChange(key) whenever ANY device writes to kv_store, so the UI can
  // re-fetch and stay in sync without a manual restart. Returns an unsubscribe fn.
  subscribe(onChange) {
    const channel = supabase
      .channel("kv_store_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "kv_store" }, (payload) => {
        const key = payload.new?.key || payload.old?.key;
        onChange(key);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  },
};
