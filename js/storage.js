/* =========================================================
   storage.js — ניהול מצב: ברירות מחדל, עריכות, שיתוף, ייצוא
   מודל: state = { v, dayStops: {dayId:[placeIds]}, custom: {id:placeObj} }
   custom מכיל גם מקומות חדשים וגם עריכות של מקומות ברירת-מחדל.
   ========================================================= */
"use strict";

const LS_KEY = "jtm.v1";

const Store = (() => {
  let state = null;
  const undoStack = [];
  const listeners = [];

  /* --- ברירות מחדל --- */
  function defaultPlace(id) {
    const p = PLACES[id];
    if (!p) return null;
    const c = COORDS[id] || CITY_CENTERS[p.city] || [35.68, 139.75];
    return { id, n: p.n, en: p.en, city: p.city, cat: p.cat, d: p.d || "", part: p.part || "",
      book: p.book || "", site: p.site || "", klook: p.klook || "", approx: !!p.approx,
      lat: c[0], lng: c[1] };
  }
  function defaultDayStops() {
    const m = {};
    for (const d of DAYS) m[d.id] = d.stops.slice();
    return m;
  }
  function freshState() {
    return { v: TRIP.version, dayStops: defaultDayStops(), custom: {}, checked: {}, visited: {} };
  }

  /* --- גישה --- */
  function getPlace(id) {
    if (state.custom[id]) return state.custom[id];
    return defaultPlace(id);
  }
  function dayStops(dayId) { return state.dayStops[dayId] || []; }

  /* --- מוטציות --- */
  function snapshot() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 80) undoStack.shift();
  }
  function mutate(fn) {
    snapshot();
    fn(state);
    persist();
    emit("local");
  }
  function undo() {
    if (!undoStack.length) return false;
    state = JSON.parse(undoStack.pop());
    persist();
    emit("local");
    return true;
  }
  function canUndo() { return undoStack.length > 0; }

  function upsertPlace(place) { mutate(s => { s.custom[place.id] = place; }); }
  function removeStop(dayId, idx) { mutate(s => { s.dayStops[dayId].splice(idx, 1); }); }
  function addStop(dayId, placeId, idx) {
    mutate(s => {
      const arr = s.dayStops[dayId];
      if (idx == null || idx < 0 || idx > arr.length) arr.push(placeId);
      else arr.splice(idx, 0, placeId);
    });
  }
  function replaceStop(dayId, idx, placeId) { mutate(s => { s.dayStops[dayId][idx] = placeId; }); }
  function moveStop(dayId, from, to) {
    mutate(s => {
      const arr = s.dayStops[dayId];
      if (to < 0 || to >= arr.length) return;
      arr.splice(to, 0, arr.splice(from, 1)[0]);
    });
  }
  function moveStopToDay(fromDay, idx, toDay) {
    mutate(s => {
      const [id] = s.dayStops[fromDay].splice(idx, 1);
      s.dayStops[toDay].push(id);
    });
  }
  function toggleChecked(placeId) {
    mutate(s => { if (s.checked[placeId]) delete s.checked[placeId]; else s.checked[placeId] = true; });
  }
  function isChecked(placeId) { return !!state.checked[placeId]; }
  function toggleVisited(placeId) {
    mutate(s => { if (s.visited[placeId]) delete s.visited[placeId]; else s.visited[placeId] = true; });
  }
  function isVisited(placeId) { return !!(state.visited && state.visited[placeId]); }

  function setCoords(placeId, lat, lng) {
    mutate(s => {
      const p = s.custom[placeId] || defaultPlace(placeId);
      p.lat = +lat.toFixed(5); p.lng = +lng.toFixed(5); p.approx = false;
      s.custom[placeId] = p;
    });
  }
  function resetAll() {
    snapshot();
    state = freshState();
    persist();
    emit("local");
  }

  /* --- התמדה --- */
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }
  function validate(s) {
    if (!s || typeof s !== "object" || s.v !== TRIP.version) return null;
    if (!s.dayStops || !s.custom) return null;
    const clean = freshState();
    for (const d of DAYS) {
      if (Array.isArray(s.dayStops[d.id])) clean.dayStops[d.id] = s.dayStops[d.id].filter(id => typeof id === "string");
    }
    for (const [id, p] of Object.entries(s.custom)) {
      if (p && typeof p.n === "string" && isFinite(p.lat) && isFinite(p.lng)) clean.custom[id] = p;
    }
    if (s.checked && typeof s.checked === "object") {
      for (const [id, v] of Object.entries(s.checked)) if (v === true) clean.checked[id] = true;
    }
    if (s.visited && typeof s.visited === "object") {
      for (const [id, v] of Object.entries(s.visited)) if (v === true) clean.visited[id] = true;
    }
    // הסר עצירות שמצביעות למקום לא קיים
    for (const d of DAYS) clean.dayStops[d.id] = clean.dayStops[d.id].filter(id => clean.custom[id] || PLACES[id]);
    return clean;
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = validate(JSON.parse(raw));
        if (s) { state = s; return; }
      }
    } catch (e) { /* corrupt */ }
    state = freshState();
  }

  /* --- דיף לשיתוף --- */
  function diff() {
    const d = { v: TRIP.version, dayStops: {}, custom: state.custom };
    if (Object.keys(state.checked || {}).length) d.checked = state.checked;
    if (Object.keys(state.visited || {}).length) d.visited = state.visited;
    const def = defaultDayStops();
    for (const day of DAYS) {
      if (JSON.stringify(state.dayStops[day.id]) !== JSON.stringify(def[day.id]))
        d.dayStops[day.id] = state.dayStops[day.id];
    }
    return d;
  }
  function applyDiff(d) {
    const s = freshState();
    if (d.custom) s.custom = d.custom;
    if (d.checked) s.checked = d.checked;
    if (d.visited) s.visited = d.visited;
    if (d.dayStops) for (const [k, v] of Object.entries(d.dayStops)) if (s.dayStops[k]) s.dayStops[k] = v;
    const clean = validate(s);
    if (!clean) throw new Error("bad diff");
    snapshot();
    state = clean;
    persist();
    emit("local");
  }
  function isDirty() {
    const d = diff();
    return Object.keys(d.dayStops).length > 0 || Object.keys(d.custom).length > 0 || !!d.checked || !!d.visited;
  }

  /* --- סנכרון --- */
  function snapshotState() { return JSON.parse(JSON.stringify(state)); }
  function replaceState(newState) {
    const clean = validate(newState);
    if (!clean) throw new Error("bad remote state");
    state = clean;
    persist();
    emit("remote");
  }

  /* --- קידוד שיתוף (gzip+base64url, נפילה ל-base64 רגיל) --- */
  async function encodeShare() {
    const json = JSON.stringify(diff());
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream !== "undefined") {
      const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      return "1." + b64url(new Uint8Array(buf));
    }
    return "0." + b64url(bytes);
  }
  async function decodeShare(str) {
    const dot = str.indexOf(".");
    const mode = str.slice(0, dot), body = str.slice(dot + 1);
    const bytes = unb64url(body);
    let json;
    if (mode === "1") {
      if (typeof DecompressionStream === "undefined") throw new Error("דפדפן ישן מדי לפתיחת הקישור");
      const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      json = new TextDecoder().decode(buf);
    } else {
      json = new TextDecoder().decode(bytes);
    }
    return JSON.parse(json);
  }
  function b64url(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64url(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /* --- ייצוא/ייבוא --- */
  function exportJSON() { return JSON.stringify(state, null, 1); }
  function importJSON(text) {
    const s = validate(JSON.parse(text));
    if (!s) throw new Error("קובץ לא תקין");
    snapshot();
    state = s;
    persist();
    emit("local");
  }

  /* --- מנויים --- */
  function onChange(fn) { listeners.push(fn); }
  function emit(source) { for (const fn of listeners) fn(source); }

  load();
  return { getPlace, dayStops, upsertPlace, removeStop, addStop, replaceStop, moveStop, moveStopToDay,
    setCoords, resetAll, undo, canUndo, encodeShare, decodeShare, applyDiff, isDirty,
    exportJSON, importJSON, onChange, defaultPlace,
    toggleChecked, isChecked, toggleVisited, isVisited, snapshotState, replaceState };
})();
