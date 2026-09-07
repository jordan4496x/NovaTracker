import React, { useState, useEffect, useMemo, useRef } from "react";
import { storage } from "./storage";
import {
  Plus, X, Trash2, Pencil, ChevronDown, ChevronUp, Check,
  Thermometer, Droplets, Wind, Mountain, Calendar, MapPin,
  Flame, Settings2, Package, Layers, Zap, Wrench, TriangleAlert,
  Hand, Flag, Calculator, Eye, Download, Upload, RefreshCw, User,
  Camera, Image as ImageIcon, CloudSun
} from "lucide-react";

const TYPE_LABELS = { nobox: "No Box", box: "Box", elliot: "Elliot" };
const typeLabel = (type) => TYPE_LABELS[type] || type;
const TYPE_BADGE_CLASSES = {
  nobox: "bg-amber-950 text-amber-400",
  box: "bg-sky-950 text-sky-400",
  elliot: "bg-violet-950 text-violet-400",
};
const typeBadgeClass = (type) => TYPE_BADGE_CLASSES[type] || TYPE_BADGE_CLASSES.nobox;

const RUNS_KEY = "novalog-runs";
const COMPONENTS_KEY = "novalog-components";
const TRACKS_KEY = "novalog-tracks";
const BASELINE_KEY = "novalog-baseline";

// Tracks carry an optional lat/lon (resolved via /api/geocode, on demand)
// so weather lookups know where to query. null until resolved.
const DEFAULT_TRACKS = [
  "Beacon Dragway",
  "Beech Bend Raceway Park",
  "Bristol Dragway",
  "Ethridge Motorsports Park",
  "Holly Springs Motorsports",
  "Montgomery Motorsports",
  "Music City Raceway",
].map((name) => ({ name, lat: null, lon: null }));

const findTrack = (tracks, name) => tracks.find((t) => t.name === name) || null;

// Local calendar date, not UTC — toISOString() would show tomorrow's date
// in the evening for anyone west of UTC (e.g. 9pm CDT is already 2am UTC).
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nowTimeStr = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const genId = () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const runTimestamp = (r) => {
  const t = r.time && /^\d{2}:\d{2}$/.test(r.time) ? r.time : "00:00";
  const ts = new Date(`${r.date}T${t}:00`).getTime();
  return isNaN(ts) ? 0 : ts;
};

const MAX_GAP_MS = 14 * 60 * 60 * 1000;

const formatGap = (ms) => {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// Day-of-year distance (ignoring year, wraps around Dec 31 -> Jan 1) and
// time-of-day distance (wraps around midnight), used to find the "closest"
// historical run for Run Predictor.
const dayOfYear = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
};

const circularDayDistance = (dateA, dateB) => {
  const YEAR_LEN = 365;
  const a = dayOfYear(dateA) % YEAR_LEN;
  const b = dayOfYear(dateB) % YEAR_LEN;
  const diff = Math.abs(a - b);
  return Math.min(diff, YEAR_LEN - diff);
};

const minutesOfDay = (timeStr) => {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

const circularMinuteDistance = (a, b) => {
  if (a == null || b == null) return Infinity;
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
};

// Closest by calendar date first (ignoring year); time-of-day only breaks ties.
const findClosestRun = (candidates, targetDate, targetTime) => {
  if (candidates.length === 0) return null;
  const targetMin = minutesOfDay(targetTime);
  let best = null;
  let bestDateDist = Infinity;
  let bestTimeDist = Infinity;
  for (const r of candidates) {
    const dDist = circularDayDistance(r.date, targetDate);
    const tDist = circularMinuteDistance(minutesOfDay(r.time), targetMin);
    if (dDist < bestDateDist || (dDist === bestDateDist && tDist < bestTimeDist)) {
      best = r;
      bestDateDist = dDist;
      bestTimeDist = tDist;
    }
  }
  return best;
};

const fmt = (v, d = 3) => {
  if (v === "" || v === null || v === undefined || isNaN(v)) return "—";
  return Number(v).toFixed(d);
};

// For raw, directly-entered values only (RT, 60', 330', 1/8 ET, MPH,
// Dial-In, Delay) — truncates to d decimals instead of rounding, so a
// 4-decimal timing-system reading shows its actual 3rd digit rather than a
// rounded one. Computed values (segments, Package) should keep using fmt(),
// since rounding there correctly absorbs floating-point subtraction noise.
const fmtTrunc = (v, d = 3) => {
  if (v === "" || v === null || v === undefined || isNaN(v)) return "—";
  const num = Number(v);
  const sign = num < 0 ? "-" : "";
  const fixed = Math.abs(num).toFixed(d + 4);
  const dot = fixed.indexOf(".");
  return sign + (d === 0 ? fixed.slice(0, dot) : fixed.slice(0, dot + 1 + d));
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
};

const fmtTime = (t) => {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  if (isNaN(h)) return "";
  const suffix = h >= 12 ? "p" : "a";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr}${suffix}`;
};

const emptyForm = (type, lastTrack = "") => ({
  id: null,
  type,
  date: todayStr(),
  time: nowTimeStr(),
  track: lastTrack,
  rt: "",
  sixty: "1.5",
  threeThirty: "4.5",
  eighth: "7.0",
  mph: "",
  dialIn: "",
  delay: "",
  lane: "L",
  lifted: false,
  result: null, // 'trial' | 'win' | 'lose' | null
  temp: "",
  humidity: "",
  waterGrains: "",
  da: "",
  serviceNote: "",
});

function computeSegments(run) {
  const sixty = parseFloat(run.sixty);
  const threeThirty = parseFloat(run.threeThirty);
  const eighth = parseFloat(run.eighth);
  const seg60_330 = !isNaN(sixty) && !isNaN(threeThirty) ? threeThirty - sixty : null;
  const seg330_8th = !isNaN(threeThirty) && !isNaN(eighth) ? eighth - threeThirty : null;
  return { seg60_330, seg330_8th };
}

function computePackage(run) {
  const dial = parseFloat(run.dialIn);
  const eighth = parseFloat(run.eighth);
  const rt = parseFloat(run.rt);
  if (isNaN(dial) || isNaN(eighth) || isNaN(rt)) return null;
  return rt + (eighth - dial);
}

// Package = reaction time + how far off the dial-in you were. A negative RT
// is a foul (red light) and running quicker than the dial is a breakout —
// both override the numeric package since the run result is voided either way.
function packageDisplay(run) {
  const dial = parseFloat(run.dialIn);
  const eighth = parseFloat(run.eighth);
  const rt = parseFloat(run.rt);
  const hasDial = run.dialIn !== "" && run.dialIn !== null && run.dialIn !== undefined && !isNaN(dial);
  if (!isNaN(rt) && rt < 0) return { text: "Red", tone: "red" };
  if (hasDial && !isNaN(eighth) && eighth < dial) return { text: "Brkout", tone: "red" };
  const pkg = computePackage(run);
  if (pkg == null) return { text: "—", tone: undefined };
  return { text: `${pkg >= 0 ? "+" : ""}${pkg.toFixed(3)}`, tone: "green" };
}

// Green (fast/best) -> Red (slow/worst) gradient for a value within a day's range
function segColor(v, min, max) {
  if (v == null || isNaN(v)) return "#3f3f46"; // zinc-700 fallback
  if (max === min) return "#f59e0b"; // amber-500 when no spread
  const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
  const from = [16, 185, 129]; // emerald-500
  const to = [239, 68, 68]; // red-500
  const r = Math.round(from[0] + t * (to[0] - from[0]));
  const g = Math.round(from[1] + t * (to[1] - from[1]));
  const b = Math.round(from[2] + t * (to[2] - from[2]));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function NovaRunTracker() {
  const [loaded, setLoaded] = useState(false);
  const [runs, setRuns] = useState([]);
  const [components, setComponents] = useState([]);
  const [tracks, setTracks] = useState(DEFAULT_TRACKS);
  // Date of the most recent "rebaseline" (e.g. an engine rebuild) — when
  // set, Run Predictor / the DA table / lift estimates only draw on runs
  // from this date forward, since older runs may no longer reflect how the
  // car performs. Old runs and their own historical displays are untouched.
  const [predictiveBaseline, setPredictiveBaseline] = useState(null);
  const [tab, setTab] = useState("nobox"); // nobox | box | all | setup
  // Date-range filter for the No Box/Box/Elliot tabs. Plain component state
  // on purpose — never persisted, so every fresh load starts back at "All".
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(emptyForm("nobox"));
  const [expandedId, setExpandedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmServiceId, setConfirmServiceId] = useState(null);
  const [newCompName, setNewCompName] = useState("");
  const [historyFor, setHistoryFor] = useState(null);
  const [editingCountId, setEditingCountId] = useState(null);
  const [editingCountVal, setEditingCountVal] = useState("");
  const [bigText, setBigText] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef(null);
  // Counts saves currently in flight (runs/components/tracks). While > 0,
  // the background poll skips itself — see loadData().
  const pendingWrites = useRef(0);

  const downloadBlob = (content, mime, filename) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const payload = { exportedAt: new Date().toISOString(), runs, components };
    downloadBlob(JSON.stringify(payload, null, 2), "application/json", `nova-run-log-backup-${todayStr()}.json`);
  };

  const csvEscape = (val) => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportCSV = () => {
    const headers = [
      "Date", "Time", "Type", "Track", "RT", "60ft", "330ft", "1/8 ET", "MPH",
      "DialIn", "Delay", "60-330 Seg", "330-1/8 Seg", "Package", "Lifted",
      "Result", "Temp", "Humidity", "WaterGrains", "DA", "ServiceNote",
    ];
    const sorted = [...runs].sort((a, b) => {
      const av = `${a.date}T${a.time || "00:00"}`;
      const bv = `${b.date}T${b.time || "00:00"}`;
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    const rows = sorted.map((r) => {
      const { seg60_330, seg330_8th } = computeSegments(r);
      const pkgInfo = packageDisplay(r);
      return [
        r.date, r.time || "", typeLabel(r.type), r.track,
        r.rt, r.sixty, r.threeThirty, r.eighth, r.mph, r.dialIn, r.delay,
        seg60_330 == null ? "" : seg60_330.toFixed(3),
        seg330_8th == null ? "" : seg330_8th.toFixed(3),
        pkgInfo.text === "—" ? "" : pkgInfo.text,
        r.lifted ? "Yes" : "No",
        r.result || "",
        r.temp, r.humidity, r.waterGrains, r.da, r.serviceNote,
      ].map(csvEscape).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    downloadBlob(csv, "text/csv", `nova-run-log-${todayStr()}.csv`);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.runs) || !Array.isArray(parsed.components)) {
        throw new Error("bad shape");
      }
      setPendingImport(parsed);
      setImportError("");
    } catch (err) {
      setImportError("That file doesn't look like a valid Nova Run Log backup.");
      setPendingImport(null);
    }
    e.target.value = "";
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    await persistRuns(pendingImport.runs);
    await persistComponents(pendingImport.components);
    setPendingImport(null);
  };

  useEffect(() => {
    const content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", content);
  }, []);

  const [syncing, setSyncing] = useState(false);

  const loadData = async ({ silent } = {}) => {
    // A save is still in flight (e.g. slow connection at the track) — the
    // screen already reflects it optimistically, so skip this fetch rather
    // than race the save and clobber the screen with stale server data.
    if (pendingWrites.current > 0) return;
    if (!silent) setSyncing(true);
    let loadedRuns = [];
    let loadedComponents = null;
    try {
      const r = await storage.get(RUNS_KEY);
      if (r && r.value) loadedRuns = JSON.parse(r.value);
    } catch (e) {}
    try {
      const c = await storage.get(COMPONENTS_KEY);
      if (c && c.value) loadedComponents = JSON.parse(c.value);
    } catch (e) {}
    if (!loadedComponents) {
      loadedComponents = [
        { id: "engine", name: "Engine", sinceRuns: 0, history: [], createdAt: Date.now() },
        { id: "tires", name: "Tires", sinceRuns: 0, history: [], createdAt: Date.now() },
      ];
    }
    let loadedTracks = null;
    try {
      const t = await storage.get(TRACKS_KEY);
      if (t && t.value) loadedTracks = JSON.parse(t.value);
    } catch (e) {}
    if (!loadedTracks || loadedTracks.length === 0) loadedTracks = DEFAULT_TRACKS;
    // Migrate from the old plain-string track list to {name, lat, lon}.
    const wasStringFormat = loadedTracks.some((t) => typeof t === "string");
    loadedTracks = loadedTracks.map((t) => (typeof t === "string" ? { name: t, lat: null, lon: null } : t));
    // Self-heal: make sure any track name already used on a run is always
    // selectable, even if it predates the tracks list or came from an import.
    const knownNames = new Set(loadedTracks.map((t) => t.name));
    const runTrackNames = Array.from(new Set(loadedRuns.map((r) => r.track).filter(Boolean)));
    const newFromRuns = runTrackNames.filter((n) => !knownNames.has(n)).map((name) => ({ name, lat: null, lon: null }));
    const mergedTracks = [...loadedTracks, ...newFromRuns].sort((a, b) => a.name.localeCompare(b.name));

    let loadedBaseline = null;
    try {
      const b = await storage.get(BASELINE_KEY);
      if (b && b.value) loadedBaseline = JSON.parse(b.value);
    } catch (e) {}

    setRuns(loadedRuns);
    setComponents(loadedComponents);
    setTracks(mergedTracks);
    setPredictiveBaseline(loadedBaseline);
    setLoaded(true);
    setSyncing(false);

    if (wasStringFormat || newFromRuns.length > 0) {
      persistTracks(mergedTracks);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Live sync: when another device writes a run or component change,
  // pull the fresh data automatically — no restart needed.
  useEffect(() => {
    const unsubscribe = storage.subscribe(() => {
      loadData({ silent: true });
    });
    return unsubscribe;
  }, []);

  const persistRuns = async (next) => {
    setRuns(next);
    pendingWrites.current++;
    try {
      await storage.set(RUNS_KEY, JSON.stringify(next));
    } catch (e) {
    } finally {
      pendingWrites.current--;
    }
  };

  const persistComponents = async (next) => {
    setComponents(next);
    pendingWrites.current++;
    try {
      await storage.set(COMPONENTS_KEY, JSON.stringify(next));
    } catch (e) {
    } finally {
      pendingWrites.current--;
    }
  };

  const persistTracks = async (next) => {
    setTracks(next);
    pendingWrites.current++;
    try {
      await storage.set(TRACKS_KEY, JSON.stringify(next));
    } catch (e) {
    } finally {
      pendingWrites.current--;
    }
  };

  const persistPredictiveBaseline = async (next) => {
    setPredictiveBaseline(next);
    pendingWrites.current++;
    try {
      await storage.set(BASELINE_KEY, JSON.stringify(next));
    } catch (e) {
    } finally {
      pendingWrites.current--;
    }
  };

  const addTrack = async (name, lat = null, lon = null) => {
    const trimmed = name.trim();
    if (!trimmed) return "";
    if (!findTrack(tracks, trimmed)) {
      await persistTracks([...tracks, { name: trimmed, lat, lon }].sort((a, b) => a.name.localeCompare(b.name)));
    }
    return trimmed;
  };

  // Saves resolved coordinates for a track (new or existing) so future
  // weather lookups don't need to re-geocode it.
  const setTrackLocation = async (name, lat, lon) => {
    const next = findTrack(tracks, name)
      ? tracks.map((t) => (t.name === name ? { ...t, lat, lon } : t))
      : [...tracks, { name, lat, lon }].sort((a, b) => a.name.localeCompare(b.name));
    await persistTracks(next);
  };

  // Resolves a place name (or city/state/zip) to {lat, lon, label} via the
  // geocoding endpoint. Returns null on any failure so callers can fall back
  // to prompting the user, rather than throwing.
  const geocodeLocation = async (query) => {
    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.lat !== "number" || typeof data.lon !== "number") return null;
      return data;
    } catch {
      return null;
    }
  };

  const lastTrack = useMemo(() => {
    if (runs.length === 0) return "";
    const latest = runs.reduce((best, r) => ((r.createdAt || 0) > (best.createdAt || 0) ? r : best), runs[0]);
    return latest.track || "";
  }, [runs]);

  const openAdd = (type) => {
    setForm(emptyForm(type === "all" || type === "predict" || type === "setup" ? "nobox" : type, lastTrack));
    setSheetOpen(true);
  };

  const openEdit = (run) => {
    setForm({ ...run });
    setSheetOpen(true);
  };

  const [saving, setSaving] = useState(false);

  const saveRun = async () => {
    if (saving) return;
    if (!form.track.trim()) return;
    if (form.type === "box" && `${form.delay}`.trim() === "") return;
    setSaving(true);
    try {
      const isNew = !form.id;
      const runToSave = { ...form, id: form.id || genId(), createdAt: form.createdAt || Date.now() };
      let next;
      if (isNew) {
        next = [runToSave, ...runs];
        const bumpedComponents = components.map((c) => ({ ...c, sinceRuns: c.sinceRuns + 1 }));
        await persistComponents(bumpedComponents);
      } else {
        next = runs.map((r) => (r.id === runToSave.id ? runToSave : r));
      }
      await persistRuns(next);
      setSheetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const deleteRun = async (id) => {
    const next = runs.filter((r) => r.id !== id);
    await persistRuns(next);
    setConfirmDeleteId(null);
  };

  const markServiced = async (id, rebaseline) => {
    const next = components.map((c) =>
      c.id === id
        ? {
            ...c,
            history: [{ date: todayStr(), atRunCount: c.sinceRuns }, ...c.history],
            sinceRuns: 0,
          }
        : c
    );
    await persistComponents(next);
    if (rebaseline) {
      await persistPredictiveBaseline(todayStr());
    }
    setConfirmServiceId(null);
  };

  const addComponent = async () => {
    if (!newCompName.trim()) return;
    const next = [
      ...components,
      { id: genId(), name: newCompName.trim(), sinceRuns: 0, history: [], createdAt: Date.now() },
    ];
    await persistComponents(next);
    setNewCompName("");
  };

  const removeComponent = async (id) => {
    await persistComponents(components.filter((c) => c.id !== id));
  };

  const commitCountEdit = async (id) => {
    const val = parseInt(editingCountVal, 10);
    const next = components.map((c) => (c.id === id ? { ...c, sinceRuns: isNaN(val) ? c.sinceRuns : val } : c));
    await persistComponents(next);
    setEditingCountId(null);
  };

  const visibleRuns = useMemo(() => {
    let list = runs;
    if (tab === "nobox") list = runs.filter((r) => r.type === "nobox");
    if (tab === "box") list = runs.filter((r) => r.type === "box");
    if (tab === "elliot") list = runs.filter((r) => r.type === "elliot");
    if ((tab === "nobox" || tab === "box" || tab === "elliot") && (rangeFrom || rangeTo)) {
      list = list.filter((r) => (!rangeFrom || r.date >= rangeFrom) && (!rangeTo || r.date <= rangeTo));
    }
    return [...list].sort((a, b) => {
      const av = `${a.date}T${a.time || "00:00"}`;
      const bv = `${b.date}T${b.time || "00:00"}`;
      if (av !== bv) return av < bv ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [runs, tab, rangeFrom, rangeTo]);

  // Gap to the previous run across ALL types (the car's actual last time at
  // the track), keyed by run id, regardless of which tab is being viewed.
  const timeSincePrev = useMemo(() => {
    const sorted = [...runs].sort((a, b) => {
      const ta = runTimestamp(a);
      const tb = runTimestamp(b);
      return ta !== tb ? ta - tb : (a.createdAt || 0) - (b.createdAt || 0);
    });
    const map = {};
    for (let i = 1; i < sorted.length; i++) {
      map[sorted[i].id] = runTimestamp(sorted[i]) - runTimestamp(sorted[i - 1]);
    }
    return map;
  }, [runs]);

  // For each lifted run, how much slower its 330-1/8 segment was than the
  // last full (non-lifted) run of the same type before it — the projected
  // time the lift cost. Non-lifted runs get no value (they just show "Full").
  // If a rebaseline is set, the "last full run" tracking is wiped clean the
  // moment we cross that date, so a run after a rebuild never gets compared
  // against pre-rebuild segments — runs before it keep their original,
  // still-accurate estimates.
  const liftProjection = useMemo(() => {
    const sorted = [...runs].sort((a, b) => {
      const ta = runTimestamp(a);
      const tb = runTimestamp(b);
      return ta !== tb ? ta - tb : (a.createdAt || 0) - (b.createdAt || 0);
    });
    const map = {};
    let lastFullSegByType = {};
    let crossedBaseline = false;
    for (const r of sorted) {
      if (!crossedBaseline && predictiveBaseline && r.date >= predictiveBaseline) {
        lastFullSegByType = {};
        crossedBaseline = true;
      }
      const { seg330_8th } = computeSegments(r);
      if (r.lifted) {
        const lastFull = lastFullSegByType[r.type];
        map[r.id] = lastFull != null && seg330_8th != null ? lastFull - seg330_8th : null;
      } else if (seg330_8th != null) {
        lastFullSegByType[r.type] = seg330_8th;
      }
    }
    return map;
  }, [runs, predictiveBaseline]);

  const stats = useMemo(() => {
    if (visibleRuns.length === 0) return null;
    const wins = visibleRuns.filter((r) => r.result === "win").length;
    const losses = visibleRuns.filter((r) => r.result === "lose").length;
    const validRts = visibleRuns
      .map((r) => parseFloat(r.rt))
      .filter((v) => !isNaN(v) && v >= 0);
    const avgRt = validRts.length ? validRts.reduce((a, b) => a + b, 0) / validRts.length : null;
    return { wins, losses, avgRt };
  }, [visibleRuns]);

  const [predDate, setPredDate] = useState("");
  const [predInput, setPredInput] = useState("");

  const availableDates = useMemo(() => {
    const s = new Set(runs.map((r) => r.date));
    return Array.from(s).sort((a, b) => (a < b ? 1 : -1));
  }, [runs]);

  const effectivePredDate = availableDates.includes(predDate) ? predDate : availableDates[0] || "";

  const predStats = useMemo(() => {
    if (!effectivePredDate) return { count: 0, avg: null };
    const dayRuns = runs.filter((r) => r.date === effectivePredDate && !r.lifted);
    const segs = dayRuns.map((r) => computeSegments(r).seg330_8th).filter((v) => v != null && !isNaN(v));
    if (segs.length === 0) return { count: 0, avg: null };
    const avg = segs.reduce((a, b) => a + b, 0) / segs.length;
    return { count: segs.length, avg };
  }, [runs, effectivePredDate]);

  const predicted =
    predStats.avg != null && predInput !== "" && !isNaN(parseFloat(predInput))
      ? parseFloat(predInput) + predStats.avg
      : null;

  const [predictTrack, setPredictTrack] = useState("");
  const [predictDate, setPredictDate] = useState(todayStr());
  const [predictTime, setPredictTime] = useState(nowTimeStr());

  // Run Predictor: closest full (non-lifted) run at this exact track for a
  // clean 330-1/8 segment, plus separately the actual 330' time from the
  // closest run at this track (lifted or not — lifting doesn't corrupt the
  // 330' trap since it happens later). Added together for a projected 1/8
  // ET, same idea as Run Completion but sourcing the 330' time from history
  // instead of a manual entry. Never crosses tracks. "Closest" = nearest
  // calendar date (ignoring year), ties broken by time of day.
  const runPrediction = useMemo(() => {
    if (!predictTrack) return null;
    const atTrack = runs.filter(
      (r) => r.track === predictTrack && (!predictiveBaseline || r.date >= predictiveBaseline)
    );
    const fullCandidates = atTrack.filter((r) => !r.lifted && computeSegments(r).seg330_8th != null);
    const threeThirtyCandidates = atTrack.filter((r) => !isNaN(parseFloat(r.threeThirty)));

    const seg330_8thRun = findClosestRun(fullCandidates, predictDate, predictTime);
    const threeThirtyRun = findClosestRun(threeThirtyCandidates, predictDate, predictTime);

    if (!seg330_8thRun && !threeThirtyRun) return { value: null, missing: "both" };
    if (!seg330_8thRun) return { value: null, missing: "segment330" };
    if (!threeThirtyRun) return { value: null, missing: "threeThirty" };

    const seg330_8th = computeSegments(seg330_8thRun).seg330_8th;
    const threeThirty = parseFloat(threeThirtyRun.threeThirty);

    return { value: threeThirty + seg330_8th, threeThirty, threeThirtyRun, seg330_8th, seg330_8thRun };
  }, [runs, predictTrack, predictDate, predictTime, predictiveBaseline]);

  const [daTableTrack, setDaTableTrack] = useState("");

  // DA reference table: 200ft ranges from the lowest recorded DA to the
  // highest — a row labeled 3200 covers [3200, 3400). 60-330 segment
  // averages every run at that DA (lifted or not — a lift always happens
  // after 330', so that phase is never affected). 1/8 ET uses true full
  // (non-lifted) runs only, no estimated/predicted numbers. Optionally
  // filtered to one track, and always filtered to on/after a rebaseline
  // date if one is set.
  const daTable = useMemo(() => {
    const DA_STEP = 200;
    const trackRuns = runs.filter(
      (r) => (!daTableTrack || r.track === daTableTrack) && (!predictiveBaseline || r.date >= predictiveBaseline)
    );
    const withDa = trackRuns
      .map((r) => ({ r, da: parseFloat(r.da) }))
      .filter((x) => !isNaN(x.da));
    if (withDa.length === 0) return null;

    const bucketOf = (da) => Math.floor(da / DA_STEP) * DA_STEP;

    const buckets = new Map();
    let minDa = Infinity;
    let maxDa = -Infinity;
    for (const { r, da } of withDa) {
      minDa = Math.min(minDa, da);
      maxDa = Math.max(maxDa, da);
      const key = bucketOf(da);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }

    const minBucket = bucketOf(minDa);
    const maxBucket = bucketOf(maxDa);

    const rows = [];
    for (let da = maxBucket; da >= minBucket; da -= DA_STEP) {
      const bucketRuns = buckets.get(da) || [];
      const segs = bucketRuns.map((r) => computeSegments(r).seg60_330).filter((v) => v != null && !isNaN(v));
      const avgSeg60_330 = segs.length ? segs.reduce((a, b) => a + b, 0) / segs.length : null;

      const ets = bucketRuns
        .filter((r) => !r.lifted)
        .map((r) => parseFloat(r.eighth))
        .filter((v) => !isNaN(v));
      const etLow = ets.length ? Math.min(...ets) : null;
      const etHigh = ets.length ? Math.max(...ets) : null;

      rows.push({ da, avgSeg60_330, etLow, etHigh, count: bucketRuns.length });
    }

    return rows;
  }, [runs, daTableTrack, predictiveBaseline]);

  const serviceLog = useMemo(() => {
    return runs
      .filter((r) => r.serviceNote && r.serviceNote.trim())
      .map((r) => ({ id: r.id, date: r.date, time: r.time, note: r.serviceNote.trim() }))
      .sort((a, b) => {
        const av = `${a.date}T${a.time || "00:00"}`;
        const bv = `${b.date}T${b.time || "00:00"}`;
        return av < bv ? 1 : av > bv ? -1 : 0;
      });
  }, [runs]);

  const daySegments = useMemo(() => {
    if (tab !== "nobox" && tab !== "box" && tab !== "elliot") return { date: null, items: [] };
    const typed = runs.filter((r) => r.type === tab);
    if (typed.length === 0) return { date: null, items: [] };
    const withTs = typed
      .map((r) => ({ r, ts: runTimestamp(r) }))
      .sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : (a.r.createdAt || 0) - (b.r.createdAt || 0)));
    const latestTs = withTs[withTs.length - 1].ts;
    const windowStart = latestTs - 24 * 60 * 60 * 1000;
    const recent = withTs.filter((x) => x.ts >= windowStart).slice(-10);
    const values = recent.map((x) => computeSegments(x.r).seg60_330).filter((v) => v != null && !isNaN(v));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const items = recent.map((x) => {
      const seg = computeSegments(x.r).seg60_330;
      return { id: x.r.id, seg, color: segColor(seg, min, max) };
    });
    return { date: recent[recent.length - 1].r.date, items };
  }, [runs, tab]);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-amber-400 font-mono text-sm tracking-widest animate-pulse">LOADING LOG…</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-zinc-950 text-zinc-100 pb-28"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", zoom: bigText ? 1.5 : 1 }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        html, body { touch-action: pan-x pan-y; overscroll-behavior: none; }
        .font-display { font-family: 'Oswald', sans-serif; letter-spacing: 0.02em; }
        .font-num { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Flame className="text-amber-400" size={20} />
            <div className="font-display text-lg font-semibold uppercase tracking-widest text-zinc-50">
              Nova Run Log
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData()}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400"
              title="Refresh from database"
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => setBigText(!bigText)}
              className={`flex items-center gap-1 text-[10px] font-display uppercase tracking-wide px-2.5 py-1.5 rounded-full border ${
                bigText ? "bg-amber-400 border-amber-400 text-zinc-950" : "bg-zinc-900 border-zinc-800 text-zinc-400"
              }`}
            >
              <Eye size={13} />
              No Glasses
            </button>
          </div>
        </div>

        {tab === "nobox" || tab === "box" || tab === "elliot" ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                60-330 Segment · {typeLabel(tab)} {daySegments.date ? `· ${fmtDate(daySegments.date)}` : ""}
              </div>
            </div>
            {daySegments.items.length === 0 ? (
              <div className="text-xs text-zinc-600">No runs logged yet for this tab.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {daySegments.items.map((it, i) => (
                  <div
                    key={it.id}
                    className="flex flex-col items-center justify-center rounded-md w-12 py-1"
                    style={{ backgroundColor: it.color }}
                    title={`Run ${i + 1}`}
                  >
                    <span className="font-num text-[10px] font-bold text-zinc-950">
                      {it.seg == null ? "—" : it.seg.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5 mt-3">Filter by Date</div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs font-num text-zinc-100 focus:outline-none focus:border-amber-500"
              />
              <span className="text-zinc-600 text-[10px] uppercase shrink-0">to</span>
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs font-num text-zinc-100 focus:outline-none focus:border-amber-500"
              />
              {(rangeFrom || rangeTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setRangeFrom("");
                    setRangeTo("");
                  }}
                  className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-400 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900"
                >
                  All
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500">
            {tab === "all" ? "All logged runs, newest first" : tab === "predict" ? "Complete a lifted run, or predict a future one" : "Component counters & service log"}
          </div>
        )}
      </div>

      {/* Stats strip */}
      {tab !== "setup" && tab !== "predict" && (
        <div className="px-4 pt-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Wins", stats ? stats.wins : 0],
              ["Losses", stats ? stats.losses : 0],
              ["Avg RT", stats && stats.avgRt != null ? fmt(stats.avgRt) : "—"],
            ].map(([label, val]) => (
              <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-1 text-center">
                <div className="font-num text-amber-400 text-base font-semibold">{val}</div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-4 mt-4 space-y-3">
        {tab === "setup" ? (
          <SetupPanel
            components={components}
            newCompName={newCompName}
            setNewCompName={setNewCompName}
            addComponent={addComponent}
            removeComponent={removeComponent}
            onMarkServiceClick={setConfirmServiceId}
            historyFor={historyFor}
            setHistoryFor={setHistoryFor}
            editingCountId={editingCountId}
            setEditingCountId={setEditingCountId}
            editingCountVal={editingCountVal}
            setEditingCountVal={setEditingCountVal}
            commitCountEdit={commitCountEdit}
            serviceLog={serviceLog}
            exportJSON={exportJSON}
            exportCSV={exportCSV}
            fileInputRef={fileInputRef}
            importError={importError}
          />
        ) : tab === "predict" ? (
          <PredictionPanel
            availableDates={availableDates}
            effectivePredDate={effectivePredDate}
            setPredDate={setPredDate}
            predStats={predStats}
            predInput={predInput}
            setPredInput={setPredInput}
            predicted={predicted}
            tracks={tracks}
            onAddTrack={addTrack}
            onGeocode={geocodeLocation}
            onSetLocation={setTrackLocation}
            predictTrack={predictTrack}
            setPredictTrack={setPredictTrack}
            predictDate={predictDate}
            setPredictDate={setPredictDate}
            predictTime={predictTime}
            setPredictTime={setPredictTime}
            runPrediction={runPrediction}
            daTable={daTable}
            daTableTrack={daTableTrack}
            setDaTableTrack={setDaTableTrack}
            predictiveBaseline={predictiveBaseline}
          />
        ) : visibleRuns.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <Layers className="mx-auto mb-3 text-zinc-700" size={28} />
            <div className="font-display uppercase tracking-wide text-sm">No runs logged yet</div>
            <div className="text-xs mt-1">Tap the + button to log your first pass.</div>
          </div>
        ) : (
          visibleRuns.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() => setExpandedId(expandedId === run.id ? null : run.id)}
              onEdit={() => openEdit(run)}
              onDelete={() => setConfirmDeleteId(run.id)}
              showTypeBadge={tab === "all"}
              sincePrevMs={timeSincePrev[run.id]}
              liftDiff={liftProjection[run.id]}
            />
          ))
        )}
      </div>

      {/* Delete confirm */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-xs">
            <div className="flex items-center gap-2 text-red-400 mb-2">
              <TriangleAlert size={18} />
              <div className="font-display uppercase text-sm tracking-wide">Delete run?</div>
            </div>
            <div className="text-xs text-zinc-400 mb-4">This can't be undone.</div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteRun(confirmDeleteId)}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark serviced / rebaseline confirm */}
      {confirmServiceId && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-xs">
            <div className="flex items-center gap-2 text-emerald-400 mb-2">
              <Wrench size={18} />
              <div className="font-display uppercase text-sm tracking-wide">
                Mark {components.find((c) => c.id === confirmServiceId)?.name || "item"} serviced?
              </div>
            </div>
            <div className="text-xs text-zinc-400 mb-4">
              Rebaseline the predictive calculations (Run Predictor, DA table, lift estimates) from today forward?
              Do this for a change big enough to affect how the car performs, like an engine rebuild — a routine
              service usually isn't. Every existing run stays in your history either way.
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => markServiced(confirmServiceId, true)}
                className="w-full py-2 rounded-lg bg-amber-400 text-zinc-950 text-sm font-medium"
              >
                Yes, Rebaseline
              </button>
              <button
                onClick={() => markServiced(confirmServiceId, false)}
                className="w-full py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm font-medium"
              >
                No, Just Log Service
              </button>
              <button
                onClick={() => setConfirmServiceId(null)}
                className="w-full py-2 rounded-lg text-zinc-500 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for restoring a backup */}
      <input type="file" accept="application/json" ref={fileInputRef} onChange={handleImportFile} className="hidden" />

      {/* Restore backup confirm */}
      {pendingImport && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-xs">
            <div className="flex items-center gap-2 text-amber-400 mb-2">
              <TriangleAlert size={18} />
              <div className="font-display uppercase text-sm tracking-wide">Restore backup?</div>
            </div>
            <div className="text-xs text-zinc-400 mb-4">
              This file has {pendingImport.runs.length} run{pendingImport.runs.length === 1 ? "" : "s"} and{" "}
              {pendingImport.components.length} component{pendingImport.components.length === 1 ? "" : "s"}
              {pendingImport.exportedAt ? `, exported ${new Date(pendingImport.exportedAt).toLocaleDateString()}` : ""}.
              This will replace everything currently in the tracker ({runs.length} run{runs.length === 1 ? "" : "s"}).
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingImport(null)}
                className="flex-1 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-zinc-950 text-sm font-medium"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-zinc-900 border-t border-zinc-800 flex">
        {[
          ["nobox", "No Box", Zap],
          ["box", "Box", Package],
          ["elliot", "Elliot", User],
          ["predict", "Predict", Calculator],
          ["all", "All", Layers],
          ["setup", "Service Items", Settings2],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 ${
              tab === key ? "text-amber-400" : "text-zinc-500"
            }`}
          >
            <Icon size={18} />
            <span className="text-[10px] font-display uppercase tracking-wide">{label}</span>
          </button>
        ))}
      </div>

      {/* Floating add button */}
      {tab !== "setup" && tab !== "predict" && (
        <button
          onClick={() => openAdd(tab)}
          className="fixed bottom-20 right-4 z-30 bg-amber-400 text-zinc-950 rounded-full w-14 h-14 flex items-center justify-center shadow-lg active:scale-95 transition"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      )}

      {/* Add/Edit sheet */}
      {sheetOpen && (
        <RunSheet
          form={form}
          setForm={setForm}
          onSave={saveRun}
          saving={saving}
          onClose={() => setSheetOpen(false)}
          bigText={bigText}
          setBigText={setBigText}
          tracks={tracks}
          onAddTrack={addTrack}
          onGeocode={geocodeLocation}
          onSetLocation={setTrackLocation}
        />
      )}
    </div>
  );
}

const RESULT_LABEL = { trial: "Time Trial", win: "Win", lose: "Lose" };

function RunCard({ run, expanded, onToggle, onEdit, onDelete, showTypeBadge, sincePrevMs, liftDiff }) {
  const { seg60_330, seg330_8th } = computeSegments(run);
  const pkgInfo = packageDisplay(run);
  const hasDial = run.dialIn !== "" && run.dialIn !== null && run.dialIn !== undefined && !isNaN(parseFloat(run.dialIn));
  const gapText =
    sincePrevMs != null && sincePrevMs >= 0 && sincePrevMs <= MAX_GAP_MS ? formatGap(sincePrevMs) : null;
  const liftLabel = run.lifted
    ? `Lift${liftDiff != null ? ` ${liftDiff >= 0 ? "+" : ""}${liftDiff.toFixed(3)}` : ""}`
    : "Full";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-center justify-between pl-3 pr-2 pt-2">
          <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className="font-num shrink-0">{fmtDate(run.date)}</span>
            {run.time && (
              <span className="font-num shrink-0 text-zinc-600">
                {fmtTime(run.time)}
                {gapText && ` (${gapText})`}
              </span>
            )}
            <span className="text-zinc-700 shrink-0">·</span>
            <span className="truncate">{run.track || "—"}</span>
            {showTypeBadge && (
              <span
                className={`shrink-0 text-[9px] uppercase font-display tracking-wide px-1.5 py-0.5 rounded-full ${typeBadgeClass(
                  run.type
                )}`}
              >
                {typeLabel(run.type)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            <span
              className={`text-[10px] font-display uppercase tracking-wide ${
                run.lifted ? "text-amber-400" : "text-zinc-500"
              }`}
            >
              {liftLabel}
            </span>
            {run.serviceNote && <Wrench size={12} className="text-emerald-400" />}
            {run.result === "win" && (
              <span className="text-[10px] font-display uppercase tracking-wide text-emerald-400">Win</span>
            )}
            {run.result === "lose" && (
              <span className="text-[10px] font-display uppercase tracking-wide text-red-400">Loss</span>
            )}
            {run.result === "trial" && <Flag size={13} className="text-zinc-400" />}
            {expanded ? <ChevronUp size={16} className="text-zinc-500" /> : <ChevronDown size={16} className="text-zinc-500" />}
          </div>
        </div>

        <div className="hide-scrollbar overflow-x-auto flex gap-1.5 px-3 pt-1.5 pb-2">
          <CompactStat label="Dial" value={hasDial ? fmtTrunc(run.dialIn, 2) : "—"} />
          <CompactStat label="RT" value={fmtTrunc(run.rt)} />
          <CompactStat label="60'" value={fmtTrunc(run.sixty)} />
          <CompactStat label="330'" value={fmtTrunc(run.threeThirty)} />
          <CompactStat label="60-330" value={fmt(seg60_330)} tone="amber" />
          <CompactStat label="1/8 ET" value={fmtTrunc(run.eighth)} tone="bright" />
          <CompactStat label="MPH" value={fmtTrunc(run.mph, 2)} />
          <CompactStat label="330-1/8" value={fmt(seg330_8th)} tone="amber" />
          <CompactStat label="Package" value={pkgInfo.text} tone={pkgInfo.tone} />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-zinc-800 mt-1">
          <div className="grid grid-cols-2 gap-2 mb-3 mt-3">
            <Stat label="330-1/8 seg" value={fmt(seg330_8th)} accent={!run.lifted} tone={run.lifted ? "red" : undefined} />
            <Stat label="Package" value={pkgInfo.text} tone={pkgInfo.tone} />
          </div>

          {run.type === "box" && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Stat label="Delay" value={fmtTrunc(run.delay)} />
              <div />
            </div>
          )}

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {run.result && (
              <span
                className={`text-[10px] uppercase font-display tracking-wide px-2 py-0.5 rounded-full border ${
                  run.result === "win"
                    ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                    : run.result === "lose"
                    ? "bg-red-950 text-red-400 border-red-800"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                {RESULT_LABEL[run.result]}
              </span>
            )}
            {run.lifted && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-950/50 border border-amber-900 rounded-lg px-2 py-1">
                <Hand size={11} />
                <span>Lifted</span>
              </div>
            )}
            {run.serviceNote && (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/50 border border-emerald-900 rounded-lg px-2 py-1">
                <Wrench size={11} />
                <span className="truncate">{run.serviceNote}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2 mb-3">
            <MiniStat icon={Thermometer} label="Temp" value={run.temp ? `${run.temp}°F` : "—"} />
            <MiniStat icon={Droplets} label="Humidity" value={run.humidity ? `${run.humidity}%` : "—"} />
            <MiniStat icon={Wind} label="Grains" value={run.waterGrains || "—"} />
            <MiniStat icon={Mountain} label="DA" value={run.da || "—"} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={onEdit}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-medium"
            >
              <Pencil size={13} /> Edit
            </button>
            <button
              onClick={onDelete}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-800 text-red-400 text-xs font-medium"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CompactStat({ label, value, tone }) {
  const color =
    tone === "amber" ? "text-amber-400" :
    tone === "bright" ? "text-zinc-50" :
    tone === "red" ? "text-red-400" :
    tone === "green" ? "text-emerald-400" :
    "text-zinc-300";
  return (
    <div className="shrink-0 w-14 bg-zinc-950 border border-zinc-800 rounded-md py-1 text-center">
      <div className="text-[8px] uppercase tracking-wide text-zinc-500 leading-none">{label}</div>
      <div className={`font-num text-xs font-semibold leading-tight mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value, accent, tone }) {
  const color = tone === "red" ? "text-red-400" : tone === "green" ? "text-emerald-400" : accent ? "text-amber-400" : "text-zinc-200";
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`font-num text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col items-center bg-zinc-950 border border-zinc-800 rounded-lg py-2">
      <Icon size={13} className="text-zinc-500 mb-1" />
      <div className="font-num text-xs text-zinc-200">{value}</div>
      <div className="text-[9px] text-zinc-600 uppercase">{label}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{label}</div>
      <input
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
      />
    </div>
  );
}

// Shared track dropdown used everywhere a track is picked. Lets the user add
// a brand new track inline, which persists it to the shared track list.
function TrackSelect({ tracks, value, onChange, onAddTrack, onGeocode, onSetLocation }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [locating, setLocating] = useState(null); // track name currently being located, or null

  const names = tracks.map((t) => t.name);
  const options = value && !names.includes(value) ? [value, ...names] : names;

  const confirmAdd = async () => {
    const trimmed = newName.trim();
    setAdding(false);
    setNewName("");
    if (!trimmed) return;
    await onAddTrack(trimmed);
    onChange(trimmed);
    setLocating(trimmed);
  };

  if (locating) {
    return (
      <TrackLocationPrompt
        trackName={locating}
        onGeocode={onGeocode}
        onResolved={async (lat, lon) => {
          await onSetLocation(locating, lat, lon);
          setLocating(null);
        }}
        onSkip={() => setLocating(null)}
      />
    );
  }

  if (adding) {
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New track name"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
        />
        <button
          type="button"
          onClick={confirmAdd}
          className="px-3 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-medium"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setNewName("");
          }}
          className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-medium"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      value={value || ""}
      onChange={(e) => {
        if (e.target.value === "__add__") {
          setAdding(true);
          return;
        }
        onChange(e.target.value);
      }}
      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
    >
      <option value="" disabled>
        Select a track
      </option>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      <option value="__add__">+ Add new track…</option>
    </select>
  );
}

// Resolves a track name to lat/lon: tries the track name itself first, and
// if that fails (common for niche venue names) falls back to asking for a
// nearby city, state, or zip. Shared between "add new track" and "Get
// Weather" whenever a track is missing coordinates.
function TrackLocationPrompt({ trackName, onGeocode, onResolved, onSkip }) {
  const [status, setStatus] = useState("loading"); // loading | confirm | manual
  const [result, setResult] = useState(null);
  const [manualQuery, setManualQuery] = useState("");
  const [manualError, setManualError] = useState("");

  useEffect(() => {
    let cancelled = false;
    onGeocode(trackName)
      .then((r) => {
        if (cancelled) return;
        if (r) {
          setResult(r);
          setStatus("confirm");
        } else {
          setStatus("manual");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("manual");
      });
    return () => {
      cancelled = true;
    };
  }, [trackName]);

  const tryManual = async () => {
    const q = manualQuery.trim();
    if (!q) return;
    setManualError("");
    setStatus("loading");
    const r = await onGeocode(q).catch(() => null);
    if (r) {
      setResult(r);
      setStatus("confirm");
    } else {
      setManualError(`Couldn't find "${q}". Try a nearby city, state, or zip.`);
      setStatus("manual");
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 py-1">
        <RefreshCw size={11} className="animate-spin" />
        Locating {trackName}…
      </div>
    );
  }

  if (status === "confirm") {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs">
        <div className="text-zinc-400 mb-2">
          Found: <span className="text-zinc-100">{result.label}</span> — use this for weather at {trackName}?
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onResolved(result.lat, result.lon)}
            className="flex-1 py-1.5 rounded-lg bg-amber-400 text-zinc-950 font-medium"
          >
            Use this
          </button>
          <button
            type="button"
            onClick={() => setStatus("manual")}
            className="flex-1 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 font-medium"
          >
            Try a different location
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs">
      <div className="text-zinc-400 mb-2">Couldn't automatically find "{trackName}". Enter a nearby city, state, or zip:</div>
      <div className="flex gap-2">
        <input
          autoFocus
          value={manualQuery}
          onChange={(e) => setManualQuery(e.target.value)}
          placeholder="e.g. Bristol, TN or 37620"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
        />
        <button type="button" onClick={tryManual} className="px-3 py-1.5 rounded-lg bg-amber-400 text-zinc-950 font-medium">
          Find
        </button>
      </div>
      {manualError && <div className="text-red-400 mt-1.5">{manualError}</div>}
      <button type="button" onClick={onSkip} className="text-zinc-500 mt-2 underline">
        Skip for now
      </button>
    </div>
  );
}

const SCAN_FIELDS = ["dialIn", "rt", "sixty", "threeThirty", "eighth", "mph"];

function RunSheet({ form, setForm, onSave, saving, onClose, bigText, setBigText, tracks, onAddTrack, onGeocode, onSetLocation }) {
  const set = (key) => (val) => setForm({ ...form, [key]: val });

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const cameraInputRef = useRef(null);
  const libraryInputRef = useRef(null);

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsDataURL(file);
    });

  const handleScanFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setScanError("");
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/scan-timeslip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64,
          mediaType: file.type || "image/jpeg",
          lane: form.lane === "L" ? "Left" : "Right",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.error) || "Scan failed. Try again or enter the run manually.");
      }
      const updates = {};
      SCAN_FIELDS.forEach((key) => {
        if (typeof data?.[key] === "string" && data[key].trim() !== "") {
          updates[key] = data[key];
        }
      });
      if (Object.keys(updates).length === 0) {
        setScanError("Couldn't confidently read any values from that slip — enter them manually.");
      }
      setForm((f) => ({ ...f, ...updates }));
    } catch (err) {
      setScanError(err.message || "Couldn't read that slip. Try again or enter manually.");
    } finally {
      setScanning(false);
    }
  };

  const [weatherStatus, setWeatherStatus] = useState("idle"); // idle | needsLocation | loading | error
  const [weatherError, setWeatherError] = useState("");

  const fetchWeatherFor = async (lat, lon) => {
    setWeatherStatus("loading");
    setWeatherError("");
    try {
      const res = await fetch("/api/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon, date: form.date, time: form.time }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || "Couldn't fetch weather.");
      setForm((f) => ({
        ...f,
        temp: String(data.temp),
        humidity: String(data.humidity),
        waterGrains: String(data.waterGrains),
        da: String(data.da),
      }));
      setWeatherStatus("idle");
    } catch (err) {
      setWeatherStatus("error");
      setWeatherError(err.message || "Couldn't fetch weather.");
    }
  };

  const handleGetWeather = () => {
    if (!form.track) {
      setWeatherStatus("error");
      setWeatherError("Pick a track first.");
      return;
    }
    const track = findTrack(tracks, form.track);
    if (track && track.lat != null && track.lon != null) {
      fetchWeatherFor(track.lat, track.lon);
    } else {
      setWeatherStatus("needsLocation");
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-end">
      <div className="bg-zinc-950 border-t border-zinc-800 rounded-t-2xl w-full p-5 overflow-y-auto" style={{ maxHeight: "92vh" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display uppercase tracking-wide text-base text-zinc-50">
            {form.id ? "Edit Run" : "Log Run"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBigText(!bigText)}
              className={`flex items-center gap-1 text-[10px] font-display uppercase tracking-wide px-2.5 py-1.5 rounded-full border ${
                bigText ? "bg-amber-400 border-amber-400 text-zinc-950" : "bg-zinc-900 border-zinc-800 text-zinc-400"
              }`}
            >
              <Eye size={13} />
              No Glasses
            </button>
            <button
              onClick={onClose}
              disabled={saving}
              className="text-zinc-500 disabled:opacity-30"
              title={saving ? "Saving — please wait" : undefined}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {["nobox", "box", "elliot"].map((t) => (
            <button
              key={t}
              onClick={() => setForm({ ...form, type: t })}
              className={`flex-1 py-2 rounded-lg text-xs font-display uppercase tracking-wide border ${
                form.type === t ? "bg-amber-400 text-zinc-950 border-amber-400" : "bg-zinc-900 text-zinc-400 border-zinc-800"
              }`}
            >
              {typeLabel(t)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Date" type="date" value={form.date} onChange={set("date")} />
          <Field label="Time" type="time" value={form.time} onChange={set("time")} />
        </div>
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Track</div>
          <TrackSelect
            tracks={tracks}
            value={form.track}
            onChange={set("track")}
            onAddTrack={onAddTrack}
            onGeocode={onGeocode}
            onSetLocation={onSetLocation}
          />
        </div>

        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Lane</div>
          <div className="flex gap-2 mb-2">
            {["L", "R"].map((laneKey) => (
              <button
                key={laneKey}
                type="button"
                onClick={() => setForm({ ...form, lane: laneKey })}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
                  form.lane === laneKey ? "bg-amber-950 border-amber-700 text-amber-400" : "bg-zinc-900 border-zinc-800 text-zinc-400"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center border ${
                    form.lane === laneKey ? "bg-amber-500 border-amber-500" : "border-zinc-600"
                  }`}
                >
                  {form.lane === laneKey && <Check size={12} className="text-zinc-950" />}
                </span>
                {laneKey}
              </button>
            ))}
          </div>

          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Scan Timeslip (optional)</div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={scanning}
              onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-medium disabled:opacity-50"
            >
              <Camera size={14} />
              Take Photo
            </button>
            <button
              type="button"
              disabled={scanning}
              onClick={() => libraryInputRef.current && libraryInputRef.current.click()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-medium disabled:opacity-50"
            >
              <ImageIcon size={14} />
              Choose from Library
            </button>
          </div>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleScanFile}
            className="hidden"
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            onChange={handleScanFile}
            className="hidden"
          />
          {scanning && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-400 mt-2">
              <RefreshCw size={12} className="animate-spin" />
              Reading slip...
            </div>
          )}
          {scanError && !scanning && <div className="text-[11px] text-red-400 mt-2">{scanError}</div>}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">RT</div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  const cur = String(form.rt ?? "");
                  const next = cur.startsWith("-") ? cur.slice(1) : cur === "" ? "-" : `-${cur}`;
                  setForm({ ...form, rt: next });
                }}
                title="Toggle red light (negative RT)"
                className="shrink-0 w-9 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-300 text-base font-semibold active:bg-zinc-800"
              >
                ±
              </button>
              <input
                type="text"
                inputMode="decimal"
                value={form.rt}
                placeholder="0.000"
                onChange={(e) => set("rt")(e.target.value)}
                className="w-full min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          <Field label="60'" type="number" value={form.sixty} onChange={set("sixty")} placeholder="0.000" />
          <Field label="330'" type="number" value={form.threeThirty} onChange={set("threeThirty")} placeholder="0.000" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="1/8 Mile ET" type="number" value={form.eighth} onChange={set("eighth")} placeholder="0.000" />
          <Field label="MPH" type="number" value={form.mph} onChange={set("mph")} placeholder="0.00" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Dial-In (optional)" type="number" value={form.dialIn} onChange={set("dialIn")} placeholder="0.00" />
          {form.type === "box" && (
            <Field label="Delay *" type="number" value={form.delay} onChange={set("delay")} placeholder="0.000" />
          )}
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => setForm({ ...form, lifted: !form.lifted })}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
              form.lifted ? "bg-red-950 border-red-700 text-red-400" : "bg-zinc-900 border-zinc-800 text-zinc-400"
            }`}
          >
            <span
              className={`w-4 h-4 rounded flex items-center justify-center border ${
                form.lifted ? "bg-red-500 border-red-500" : "border-zinc-600"
              }`}
            >
              {form.lifted && <Check size={12} className="text-zinc-950" />}
            </span>
            Lifted?
          </button>
        </div>

        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Result</div>
          <div className="flex gap-2">
            {[
              ["trial", "Time Trial"],
              ["win", "Win"],
              ["lose", "Lose"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setForm({ ...form, result: form.result === key ? null : key })}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border ${
                  form.result === key
                    ? key === "win"
                      ? "bg-emerald-500 border-emerald-500 text-zinc-950"
                      : key === "lose"
                      ? "bg-red-500 border-red-500 text-zinc-950"
                      : "bg-zinc-100 border-zinc-100 text-zinc-950"
                    : "bg-zinc-900 border-zinc-800 text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 mb-2">
          <div className="text-[11px] uppercase tracking-wide text-zinc-600">Weather (optional)</div>
          <button
            type="button"
            onClick={handleGetWeather}
            disabled={weatherStatus === "loading"}
            className="flex items-center gap-1 text-[10px] font-display uppercase tracking-wide px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 disabled:opacity-50"
          >
            <CloudSun size={12} className={weatherStatus === "loading" ? "animate-pulse" : ""} />
            {weatherStatus === "loading" ? "Getting Weather…" : "Get Weather"}
          </button>
        </div>
        {weatherStatus === "needsLocation" && (
          <div className="mb-3">
            <TrackLocationPrompt
              trackName={form.track}
              onGeocode={onGeocode}
              onResolved={async (lat, lon) => {
                await onSetLocation(form.track, lat, lon);
                fetchWeatherFor(lat, lon);
              }}
              onSkip={() => setWeatherStatus("idle")}
            />
          </div>
        )}
        {weatherStatus === "error" && <div className="text-[11px] text-red-400 mb-2">{weatherError}</div>}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Temp (°F)" type="number" value={form.temp} onChange={set("temp")} />
          <Field label="Humidity (%)" type="number" value={form.humidity} onChange={set("humidity")} />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Water Grains" type="number" value={form.waterGrains} onChange={set("waterGrains")} />
          <Field label="DA (ft)" type="number" value={form.da} onChange={set("da")} />
        </div>

        <div className="mb-5">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Service Note (optional)</div>
          <textarea
            value={form.serviceNote}
            onChange={(e) => setForm({ ...form, serviceNote: e.target.value })}
            placeholder="e.g. Changed oil, swapped to new tires"
            rows={2}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-500"
          />
        </div>

        <button
          onClick={onSave}
          disabled={saving || !form.track.trim() || (form.type === "box" && `${form.delay}`.trim() === "")}
          className="w-full py-3 rounded-xl bg-amber-400 text-zinc-950 font-display uppercase tracking-wide text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {saving && <RefreshCw size={16} className="animate-spin" />}
          {saving ? "Saving…" : form.id ? "Save Changes" : "Save Run"}
        </button>
        {form.type === "box" && `${form.delay}`.trim() === "" && (
          <div className="text-[11px] text-zinc-600 text-center mt-2">Delay is required for Box runs.</div>
        )}
      </div>
    </div>
  );
}

function PredictionPanel({
  availableDates,
  effectivePredDate,
  setPredDate,
  predStats,
  predInput,
  setPredInput,
  predicted,
  tracks,
  onAddTrack,
  onGeocode,
  onSetLocation,
  predictTrack,
  setPredictTrack,
  predictDate,
  setPredictDate,
  predictTime,
  setPredictTime,
  runPrediction,
  daTable,
  daTableTrack,
  setDaTableTrack,
  predictiveBaseline,
}) {
  return (
    <div>
      {predictiveBaseline && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-950/50 border border-amber-900 rounded-lg px-3 py-2 mb-4">
          <RefreshCw size={12} />
          <span>
            Rebaselined {fmtDate(predictiveBaseline)} — Run Predictor and the DA table below only use runs from that
            date forward.
          </span>
        </div>
      )}

      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2 font-display">Run Completion</div>

      {availableDates.length === 0 ? (
        <div className="text-center py-10 text-zinc-500 mb-6">
          <Calculator className="mx-auto mb-3 text-zinc-700" size={28} />
          <div className="font-display uppercase tracking-wide text-sm">No runs logged yet</div>
          <div className="text-xs mt-1">Log a few runs, then come back here to predict a lifted run's true ET.</div>
        </div>
      ) : (
        <>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Race Day</div>
            <select
              value={effectivePredDate}
              onChange={(e) => setPredDate(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
            >
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {fmtDate(d)}
                </option>
              ))}
            </select>

            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">330' Time</div>
              <input
                type="number"
                inputMode="decimal"
                value={predInput}
                onChange={(e) => setPredInput(e.target.value)}
                placeholder="e.g. 4.85"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {predStats.count === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-500">
              No non-lifted runs logged on {fmtDate(effectivePredDate)} yet, so there's no clean 330-1/8 segment to
              base a prediction on.
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Predicted 1/8 ET</div>
              <div className="font-num text-4xl font-semibold text-amber-400 leading-none">
                {predicted != null ? predicted.toFixed(3) : "—"}
              </div>
              <div className="text-[11px] text-zinc-500 mt-3">
                Based on the average 330-1/8 segment ({predStats.avg.toFixed(3)}) across {predStats.count} non-lifted
                run
                {predStats.count === 1 ? "" : "s"} that day.
              </div>
            </div>
          )}

          <div className="text-[10px] text-zinc-600 mt-4 mb-6 leading-relaxed">
            This takes the 330' time you enter and adds the day's average clean (non-lifted) 330-1/8 segment,
            combining both No Box and Box runs from that date — a quick way to estimate what a lifted run would have
            gone if you'd stayed in it.
          </div>
        </>
      )}

      <div className="border-t border-zinc-800 pt-5">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2 font-display">Run Predictor</div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-3">
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Track *</div>
            <TrackSelect
              tracks={tracks}
              value={predictTrack}
              onChange={setPredictTrack}
              onAddTrack={onAddTrack}
              onGeocode={onGeocode}
              onSetLocation={onSetLocation}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Date</div>
              <input
                type="date"
                value={predictDate}
                onChange={(e) => setPredictDate(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Time of Day</div>
              <input
                type="time"
                value={predictTime}
                onChange={(e) => setPredictTime(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        </div>

        {!predictTrack ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-500">
            Pick a track to get a prediction.
          </div>
        ) : !runPrediction || runPrediction.value == null ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-500">
            {runPrediction?.missing === "both"
              ? `No runs recorded yet at ${predictTrack}.`
              : runPrediction?.missing === "segment330"
              ? `No non-lifted runs recorded yet at ${predictTrack} to source a clean 330-1/8 segment.`
              : `No 330' time recorded yet at ${predictTrack}.`}
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Predicted 1/8 ET</div>
            <div className="font-num text-4xl font-semibold text-amber-400 leading-none">
              {runPrediction.value.toFixed(3)}
            </div>
            <div className="text-[11px] text-zinc-500 mt-3 space-y-0.5">
              <div>
                330' time {fmt(runPrediction.threeThirty)} · {fmtDate(runPrediction.threeThirtyRun.date)}{" "}
                {fmtTime(runPrediction.threeThirtyRun.time)}
              </div>
              <div>
                330-1/8 seg {fmt(runPrediction.seg330_8th)} (full run) · {fmtDate(runPrediction.seg330_8thRun.date)}{" "}
                {fmtTime(runPrediction.seg330_8thRun.time)}
              </div>
            </div>
          </div>
        )}

        <div className="text-[10px] text-zinc-600 mt-4 leading-relaxed">
          Finds the closest full (non-lifted) run at this track for a clean 330-1/8 segment, and separately the
          actual 330' time from the closest run at this track (lifted or not), then adds them together — same idea
          as Run Completion above, but the 330' time comes from history instead of a manual entry. Never crosses
          tracks. "Closest" means nearest calendar date first (ignoring year), using time of day only to break ties.
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-5 mt-5">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2 font-display">Density Altitude Reference</div>
        <select
          value={daTableTrack}
          onChange={(e) => setDaTableTrack(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-num text-zinc-100 focus:outline-none focus:border-amber-500 mb-3"
        >
          <option value="">All Tracks</option>
          {tracks.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        {!daTable ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-500">
            No runs with DA recorded yet{daTableTrack ? ` at ${daTableTrack}` : ""} — log one, or use Get Weather, to
            build this table.
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-zinc-950 text-[9px] uppercase tracking-wide text-zinc-500">
              <div>Density Alt</div>
              <div className="text-center">Avg 60-330</div>
              <div className="text-right">1/8 ET Low-High</div>
            </div>
            <div className="divide-y divide-zinc-800">
              {daTable.map((row) => (
                <div key={row.da} className="grid grid-cols-3 gap-2 px-3 py-2 text-xs items-center">
                  <div className="font-num text-zinc-200">
                    {row.da.toLocaleString()}–{(row.da + 200).toLocaleString()} ft
                  </div>
                  <div className="font-num text-center text-amber-400">
                    {row.avgSeg60_330 != null ? row.avgSeg60_330.toFixed(3) : "—"}
                  </div>
                  <div className="font-num text-right text-zinc-100">
                    {row.etLow != null && row.etHigh != null
                      ? row.etLow === row.etHigh
                        ? row.etLow.toFixed(3)
                        : `${row.etLow.toFixed(3)} – ${row.etHigh.toFixed(3)}`
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="text-[10px] text-zinc-600 mt-4 leading-relaxed">
          Every 200ft from your lowest to highest recorded Density Altitude for the selected track, highest at top.
          60-330 averages any run at that DA (lifted or not — a lift always happens after 330'). 1/8 ET uses true full
          (non-lifted) runs only — no estimated or predicted numbers.
        </div>
      </div>
    </div>
  );
}

function SetupPanel({
  components,
  newCompName,
  setNewCompName,
  addComponent,
  removeComponent,
  onMarkServiceClick,
  historyFor,
  setHistoryFor,
  editingCountId,
  setEditingCountId,
  editingCountVal,
  setEditingCountVal,
  commitCountEdit,
  serviceLog,
  exportJSON,
  exportCSV,
  fileInputRef,
  importError,
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Backup & Export</div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-5">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            onClick={exportJSON}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-medium"
          >
            <Download size={13} /> Backup (.json)
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-medium"
          >
            <Download size={13} /> Runs (.csv)
          </button>
        </div>
        <button
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 text-xs font-medium"
        >
          <Upload size={13} /> Restore from Backup
        </button>
        {importError && <div className="text-[11px] text-red-400 mt-2">{importError}</div>}
        <div className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
          The .json backup restores everything exactly (runs, components, history). The .csv is for opening in Excel or
          Sheets — handy for analysis, but it can't be re-imported.
        </div>
      </div>

      <div className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Component Run Counters</div>
      <div className="space-y-2">
        {components.map((c) => (
          <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-sm uppercase tracking-wide text-zinc-100">{c.name}</div>
              <button onClick={() => removeComponent(c.id)} className="text-zinc-600">
                <X size={15} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] uppercase text-zinc-500">Runs since service</div>
                {editingCountId === c.id ? (
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      autoFocus
                      type="number"
                      value={editingCountVal}
                      onChange={(e) => setEditingCountVal(e.target.value)}
                      className="w-16 bg-zinc-950 border border-amber-500 rounded px-2 py-1 text-sm font-num text-zinc-100"
                    />
                    <button onClick={() => commitCountEdit(c.id)} className="text-amber-400">
                      <Check size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingCountId(c.id);
                      setEditingCountVal(String(c.sinceRuns));
                    }}
                    className="font-num text-2xl font-semibold text-amber-400 leading-tight"
                  >
                    {c.sinceRuns}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setHistoryFor(historyFor === c.id ? null : c.id)}
                  className="text-xs text-zinc-400 border border-zinc-800 rounded-lg px-3 py-2"
                >
                  History
                </button>
                <button
                  onClick={() => onMarkServiceClick(c.id)}
                  className="text-xs text-zinc-950 bg-emerald-400 rounded-lg px-3 py-2 font-medium"
                >
                  Mark Serviced
                </button>
              </div>
            </div>

            {historyFor === c.id && (
              <div className="mt-3 pt-3 border-t border-zinc-800 space-y-1.5">
                {c.history.length === 0 ? (
                  <div className="text-xs text-zinc-600">No service history yet.</div>
                ) : (
                  c.history.map((h, i) => (
                    <div key={i} className="flex justify-between text-xs text-zinc-400">
                      <span>{fmtDate(h.date)}</span>
                      <span className="font-num">{h.atRunCount} runs</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={newCompName}
          onChange={(e) => setNewCompName(e.target.value)}
          placeholder="Add component (e.g. Converter)"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-500"
        />
        <button onClick={addComponent} className="bg-zinc-800 text-amber-400 rounded-lg px-4">
          <Plus size={18} />
        </button>
      </div>

      <div className="text-[10px] text-zinc-600 mt-4 leading-relaxed">
        Every run you log adds +1 to each component above. Tap the number to set a starting count manually (handy mid-season). Tap "Mark Serviced" when you replace or service a part — it logs the count and resets to zero.
      </div>

      <div className="text-[11px] uppercase tracking-wide text-zinc-600 mt-6 mb-2">Service Note Log</div>
      {serviceLog.length === 0 ? (
        <div className="text-xs text-zinc-600">No service notes logged on any runs yet.</div>
      ) : (
        <div className="space-y-1.5">
          {serviceLog.map((item) => (
            <div key={item.id} className="flex items-start gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <span className="font-num text-[11px] text-zinc-500 shrink-0 pt-0.5">{fmtDate(item.date)}</span>
              <span className="text-xs text-zinc-300">{item.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
