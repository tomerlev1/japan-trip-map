/* =========================================================
   sync.js — סנכרון חי בין מכשירים מעל Supabase REST (ללא ספריות).
   מודל: "חדר" עם מזהה UUID סודי (capability URL).
   כתיבה עם בקרת גרסאות (rev) + משיכה תקופתית וברענון פוקוס.
   ========================================================= */
"use strict";

const Sync = (() => {
  const LS = "jtm.sync";
  let room = null;          // {id, rev}
  let status = "off";       // off | noconfig | ok | syncing | error
  let statusCb = () => {};
  let pushTimer = null;
  let pollTimer = null;
  let pending = false;      // דחיפה שנכשלה וממתינה
  let applyingRemote = false;

  const cfg = () => window.JTM_CONFIG || {};
  const configured = () => !!(cfg().syncUrl && cfg().syncKey);

  function setStatus(s) { status = s; statusCb(s); }
  function getStatus() { return status; }
  function roomId() { return room && room.id; }

  function loadRoom() {
    try { room = JSON.parse(localStorage.getItem(LS)) || null; } catch (e) { room = null; }
    if (room && !room.id) room = null;
  }
  function saveRoom() {
    try { room ? localStorage.setItem(LS, JSON.stringify(room)) : localStorage.removeItem(LS); } catch (e) {}
  }

  async function rpc(fn, body) {
    const r = await fetch(cfg().syncUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg().syncKey,
        "Authorization": "Bearer " + cfg().syncKey,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  /* --- פעולות --- */
  async function createRoom() {
    if (!configured()) { setStatus("noconfig"); throw new Error("noconfig"); }
    const id = crypto.randomUUID();
    setStatus("syncing");
    const res = await rpc("trip_save", { p_id: id, p_state: Store.snapshotState(), p_rev: null });
    if (!res || res.ok !== true) throw new Error("create failed");
    room = { id, rev: res.rev };
    saveRoom();
    startLoop();
    setStatus("ok");
    return id;
  }

  async function join(id) {
    if (!configured()) { setStatus("noconfig"); throw new Error("noconfig"); }
    setStatus("syncing");
    const remote = await rpc("trip_get", { p_id: id });
    if (remote && remote.state) {
      room = { id, rev: remote.rev };
      applyRemote(remote.state);
    } else {
      const res = await rpc("trip_save", { p_id: id, p_state: Store.snapshotState(), p_rev: null });
      room = { id, rev: res.rev };
    }
    saveRoom();
    startLoop();
    setStatus("ok");
  }

  function disconnect() {
    room = null;
    saveRoom();
    stopLoop();
    setStatus(configured() ? "off" : "noconfig");
  }

  function applyRemote(state) {
    applyingRemote = true;
    try { Store.replaceState(state); } finally { applyingRemote = false; }
  }

  /* --- דחיפה (debounced) --- */
  function schedulePush() {
    if (!room) return;
    clearTimeout(pushTimer);
    setStatus("syncing");
    pushTimer = setTimeout(push, 900);
  }
  async function push() {
    if (!room) return;
    try {
      const res = await rpc("trip_save", { p_id: room.id, p_state: Store.snapshotState(), p_rev: room.rev });
      if (res.ok === true) {
        room.rev = res.rev; saveRoom(); pending = false; setStatus("ok");
      } else if (res.error === "conflict") {
        room.rev = res.rev; saveRoom();
        if (res.state) applyRemote(res.state);
        pending = false; setStatus("ok");
        toast("⚡ המסלול עודכן ממכשיר אחר — הפעולה האחרונה שלכם לא נשמרה, נסו שוב");
      } else {
        pending = true; setStatus("error");
      }
    } catch (e) {
      pending = true; setStatus("error");
    }
  }

  /* --- משיכה --- */
  async function poll() {
    if (!room || document.hidden) return;
    try {
      if (pending) { await push(); if (pending) return; }
      const remote = await rpc("trip_get", { p_id: room.id });
      if (remote && remote.rev > room.rev) {
        room.rev = remote.rev; saveRoom();
        applyRemote(remote.state);
        toast("🔄 המסלול התעדכן ממכשיר אחר");
      }
      if (status !== "syncing") setStatus("ok");
    } catch (e) { setStatus("error"); }
  }
  function startLoop() {
    stopLoop();
    pollTimer = setInterval(poll, cfg().pollMs || 12000);
  }
  function stopLoop() { clearInterval(pollTimer); pollTimer = null; }

  /* --- אתחול --- */
  function init(onStatus) {
    statusCb = onStatus || (() => {});
    loadRoom();
    Store.onChange(source => { if (source !== "remote" && room) schedulePush(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    window.addEventListener("online", () => poll());
    window.addEventListener("beforeunload", () => { if (pushTimer) { clearTimeout(pushTimer); } });
    if (!configured()) { setStatus("noconfig"); return; }
    if (room) { startLoop(); poll().then(() => { if (status === "syncing") setStatus("ok"); }); setStatus("ok"); }
    else setStatus("off");
  }

  return { init, createRoom, join, disconnect, roomId, getStatus, configured };
})();
