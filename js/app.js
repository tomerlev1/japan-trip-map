/* =========================================================
   app.js — ממשק: מפה, ימים, עצירות, עריכה, קטלוג, שיתוף
   ========================================================= */
"use strict";

const CITY_EN = { "טוקיו": "Tokyo", "קיוטו": "Kyoto", "אוסקה": "Osaka", "נארה": "Nara", "האקונה": "Hakone" };
const PARTS = ["", "בוקר", "צהריים", "אחה\"צ", "ערב", "לילה", "כל היום"];

let curDay = null;          // null = כל הימים
let lastFitKey = null;
let dragIdx = null;
let catalogCtx = null;      // {mode:'add'|'replace', dayId, idx}

/* ---------- עזרים ---------- */
const $ = s => document.querySelector(s);
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function dayById(id) { return DAYS.find(d => d.id === id); }
function gmapsUrl(p) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((p.en || p.n) + ", " + (CITY_EN[p.city] || "") + " Japan");
}
function pointRef(p) { return p.approx ? (p.en || p.n) + ", " + (CITY_EN[p.city] || "") + " Japan" : p.lat + "," + p.lng; }
function navUrl(from, to) {
  return "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(pointRef(from)) +
    "&destination=" + encodeURIComponent(pointRef(to)) + "&travelmode=transit";
}
function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms || 2600);
}

/* ---------- מפה ---------- */
const map = L.map("map", { zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd", maxZoom: 20,
}).addTo(map);
map.setView([35.5, 137.5], 6);
const routeLayer = L.layerGroup().addTo(map);

function numIcon(n, color, approx) {
  return L.divIcon({
    className: "",
    html: '<div class="pin' + (approx ? " approx" : "") + '" style="--c:' + color + '">' + n + "</div>",
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16],
  });
}

function popupContent(p, day, idx) {
  const c = el("div", "pop");
  const cat = CATS[p.cat] || CATS.site;
  let html = '<div class="pop-t">' + esc(p.n) + "</div>";
  if (p.en && p.en !== p.n) html += '<div class="pop-en">' + esc(p.en) + "</div>";
  html += '<div class="pop-chips"><span class="chip">' + cat.icon + " " + cat.he + "</span>";
  if (p.part) html += '<span class="chip">' + esc(p.part) + "</span>";
  html += '<span class="chip">' + esc(p.city) + "</span></div>";
  if (p.d) html += '<div class="pop-d">' + esc(p.d) + "</div>";
  if (p.book) html += '<div class="pop-book">📌 ' + esc(p.book) + "</div>";
  if (p.approx) html += '<div class="pop-approx">⚠️ מיקום משוער — קישור הניווט מדויק (לפי שם). אפשר לגרור את הסיכה למיקום הנכון.</div>';
  c.innerHTML = html;

  const links = el("div", "pop-links");
  links.appendChild(linkBtn("🗺️ במפות Google", gmapsUrl(p)));
  if (day && idx > 0) {
    const prev = Store.getPlace(Store.dayStops(day.id)[idx - 1]);
    if (prev) links.appendChild(linkBtn("🚇 הגעה מהעצירה הקודמת", navUrl(prev, p)));
  }
  if (p.site) links.appendChild(linkBtn("🌐 אתר רשמי", p.site));
  if (p.klook) links.appendChild(linkBtn("🎟️ Klook (קוד " + TRIP.klookCode + ")", p.klook));
  c.appendChild(links);

  if (day) {
    const acts = el("div", "pop-acts");
    const bE = el("button", "mini", "✎ עריכה");
    bE.onclick = () => { map.closePopup(); openEdit(p.id, day.id, idx); };
    const bR = el("button", "mini", "⇄ החלפה");
    bR.onclick = () => { map.closePopup(); openCatalog({ mode: "replace", dayId: day.id, idx }); };
    const bX = el("button", "mini danger", "✕ הסרה");
    bX.onclick = () => { map.closePopup(); Store.removeStop(day.id, idx); toast("הוסר מהמסלול. אפשר לבטל עם ↩️"); };
    acts.append(bE, bR, bX);
    c.appendChild(acts);
  }
  return c;
}
function linkBtn(txt, url) {
  const a = el("a", "lbtn");
  a.textContent = txt; a.href = url; a.target = "_blank"; a.rel = "noopener";
  return a;
}

function renderMap() {
  routeLayer.clearLayers();
  const days = curDay ? [dayById(curDay)] : DAYS;
  const allPts = [];
  for (const day of days) {
    const stops = Store.dayStops(day.id).map(id => Store.getPlace(id)).filter(Boolean);
    const latlngs = stops.map(p => [p.lat, p.lng]);
    allPts.push(...latlngs);
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: day.color, weight: curDay ? 4 : 2.5, opacity: curDay ? 0.85 : 0.55, dashArray: curDay ? null : "4 5" }).addTo(routeLayer);
    }
    stops.forEach((p, i) => {
      if (curDay) {
        const m = L.marker([p.lat, p.lng], { icon: numIcon(i + 1, day.color, p.approx), draggable: !!p.approx, riseOnHover: true }).addTo(routeLayer);
        m.bindTooltip(p.n, { direction: "top", offset: [0, -14] });
        m.bindPopup(() => popupContent(Store.getPlace(p.id) || p, day, i), { maxWidth: 300 });
        if (p.approx) m.on("dragend", () => {
          const ll = m.getLatLng();
          Store.setCoords(p.id, ll.lat, ll.lng);
          toast("המיקום של „" + p.n + "” עודכן ✓");
        });
        m._placeId = p.id;
      } else {
        const m = L.circleMarker([p.lat, p.lng], { radius: 5, color: "#fff", weight: 1.5, fillColor: day.color, fillOpacity: 1 }).addTo(routeLayer);
        m.bindTooltip("יום " + day.n + " · " + p.n, { direction: "top" });
        m.on("click", () => selectDay(day.id));
      }
    });
  }
  const fitKey = curDay || "all";
  if (allPts.length && fitKey !== lastFitKey) {
    map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40], maxZoom: 15 });
    lastFitKey = fitKey;
  }
}

function focusStop(placeId) {
  const p = Store.getPlace(placeId);
  if (!p) return;
  map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  routeLayer.eachLayer(l => { if (l._placeId === placeId && l.openPopup) setTimeout(() => l.openPopup(), 650); });
}

/* ---------- סרגל ימים ---------- */
function renderDaybar() {
  const bar = $("#daybar");
  bar.innerHTML = "";
  const all = el("button", "dchip" + (curDay === null ? " on" : ""), "🗾 כל הימים");
  all.onclick = () => selectDay(null);
  bar.appendChild(all);
  for (const d of DAYS) {
    const b = el("button", "dchip" + (curDay === d.id ? " on" : ""),
      '<span class="dot" style="background:' + d.color + '"></span>יום ' + d.n + ' <span class="dt">' + d.date + "</span>");
    b.title = d.title;
    b.onclick = () => selectDay(d.id);
    bar.appendChild(b);
  }
}
function selectDay(id) {
  curDay = id;
  render();
  if (id) {
    const btn = $("#daybar .dchip.on");
    if (btn) btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

/* ---------- פאנל ---------- */
function renderPanel() {
  const pn = $("#panel");
  pn.innerHTML = "";
  if (!curDay) {
    pn.appendChild(el("div", "pn-head", "<h2>" + esc(TRIP.title) + "</h2><div class='pn-sub'>" + esc(TRIP.sub) + "</div>"));
    const hint = el("div", "pn-hint", "בחרו יום כדי לראות את המסלול המלא שלו, לערוך, להחליף ולסדר מחדש. כל שינוי נשמר במכשיר — ולחצן השיתוף יוצר קישור לבן/בת הזוג.");
    pn.appendChild(hint);
    for (const d of DAYS) {
      const stops = Store.dayStops(d.id);
      const row = el("button", "dayrow");
      row.innerHTML = '<span class="bar" style="background:' + d.color + '"></span>' +
        '<span class="dr-main"><b>יום ' + d.n + " · " + d.date + " · " + esc(d.dow) + "</b><span>" + esc(d.title) + "</span></span>" +
        '<span class="dr-city">' + esc(d.city) + " · " + stops.length + " עצירות</span>";
      row.onclick = () => selectDay(d.id);
      pn.appendChild(row);
    }
    return;
  }
  const d = dayById(curDay);
  const head = el("div", "pn-day");
  head.innerHTML =
    '<div class="pn-nav">' +
    '<button id="navPrev" class="mini">‹ הקודם</button>' +
    '<button id="navAll" class="mini">🗾 כל הימים</button>' +
    '<button id="navNext" class="mini">הבא ›</button></div>' +
    '<h2><span class="dot big" style="background:' + d.color + '"></span> יום ' + d.n + " · " + d.date + " · " + esc(d.dow) + "</h2>" +
    '<div class="pn-title">' + esc(d.title) + '</div>' +
    '<div class="pn-sum">' + esc(d.sum) + "</div>" +
    (d.transit ? '<div class="pn-transit">🚄 ' + esc(d.transit) + "</div>" : "");
  if (d.hotel) {
    const h = Store.getPlace(d.hotel), meta = HOTELS[d.hotel];
    if (h) head.innerHTML += '<div class="pn-hotel">🏨 <a href="' + gmapsUrl(h) + '" target="_blank" rel="noopener">' + esc(h.n) + "</a>" +
      (meta ? ' · ' + esc(meta.nights) + (meta.booked ? ' <span class="ok">הוזמן ✔</span>' : "") : "") + "</div>";
  }
  pn.appendChild(head);
  const idx0 = DAYS.indexOf(d);
  head.querySelector("#navAll").onclick = () => selectDay(null);
  head.querySelector("#navPrev").onclick = () => selectDay(DAYS[(idx0 - 1 + DAYS.length) % DAYS.length].id);
  head.querySelector("#navNext").onclick = () => selectDay(DAYS[(idx0 + 1) % DAYS.length].id);

  const list = el("div", "stops");
  const stops = Store.dayStops(d.id);
  stops.forEach((id, i) => {
    const p = Store.getPlace(id);
    if (!p) return;
    const cat = CATS[p.cat] || CATS.site;
    const row = el("div", "stop");
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML =
      '<span class="num" style="background:' + d.color + '">' + (i + 1) + "</span>" +
      '<span class="s-ic">' + cat.icon + "</span>" +
      '<span class="s-main"><b>' + esc(p.n) + (p.approx ? ' <span class="approx-tag" title="מיקום משוער">≈</span>' : "") + "</b>" +
      (p.part ? '<span class="s-part">' + esc(p.part) + "</span>" : "") + "</span>" +
      '<span class="s-acts">' +
      '<button class="ib" data-a="up" title="הזז למעלה">▲</button>' +
      '<button class="ib" data-a="down" title="הזז למטה">▼</button>' +
      '<button class="ib" data-a="edit" title="עריכה">✎</button>' +
      '<button class="ib" data-a="swap" title="החלפה באטרקציה אחרת">⇄</button>' +
      '<button class="ib danger" data-a="del" title="הסרה">✕</button></span>';
    row.addEventListener("click", e => {
      const a = e.target.closest("button")?.dataset.a;
      if (!a) { focusStop(id); return; }
      if (a === "up") Store.moveStop(d.id, i, i - 1);
      else if (a === "down") Store.moveStop(d.id, i, i + 1);
      else if (a === "edit") openEdit(id, d.id, i);
      else if (a === "swap") openCatalog({ mode: "replace", dayId: d.id, idx: i });
      else if (a === "del") { Store.removeStop(d.id, i); toast("הוסר. ↩️ לביטול"); }
    });
    row.addEventListener("dragstart", () => { dragIdx = i; row.classList.add("drag"); });
    row.addEventListener("dragend", () => { dragIdx = null; row.classList.remove("drag"); $("#panel").querySelectorAll(".stop.over").forEach(x => x.classList.remove("over")); });
    row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("over"); });
    row.addEventListener("dragleave", () => row.classList.remove("over"));
    row.addEventListener("drop", e => {
      e.preventDefault();
      if (dragIdx != null && dragIdx !== i) Store.moveStop(d.id, dragIdx, i);
    });
    list.appendChild(row);
  });
  pn.appendChild(list);
  const add = el("button", "addbtn", "＋ הוספת עצירה ליום הזה");
  add.onclick = () => openCatalog({ mode: "add", dayId: d.id, idx: null });
  pn.appendChild(add);
}

/* ---------- קטלוג ---------- */
function slug(s) {
  return "c-" + s.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
}
function catalogItems() {
  const items = [];
  const day = catalogCtx && dayById(catalogCtx.dayId);
  const inDay = new Set(day ? Store.dayStops(day.id) : []);
  for (const id of Object.keys(PLACES)) {
    if (inDay.has(id)) continue;
    const p = Store.getPlace(id);
    items.push({ kind: "place", id, n: p.n, en: p.en, city: p.city, cat: p.cat, note: p.d, book: !!p.book, klook: p.klook });
  }
  CATALOG.forEach((c, i) => items.push({ kind: "cat", id: "cat" + i, n: c.n, en: c.en, city: c.city, cat: c.cat, note: c.note || "", book: !!c.book, klook: c.klook || "", src: c }));
  return items;
}
function openCatalog(ctx) {
  catalogCtx = ctx;
  const day = dayById(ctx.dayId);
  $("#catTitle").textContent = ctx.mode === "replace"
    ? "החלפת עצירה " + (ctx.idx + 1) + " ביום " + day.n
    : "הוספת עצירה ליום " + day.n + " · " + day.title;
  $("#catSearch").value = "";
  $("#catCity").value = day.city.includes("←") ? "הכל" : day.city;
  $("#catCat").value = "הכל";
  renderCatalog();
  showModal("catModal");
  setTimeout(() => $("#catSearch").focus(), 50);
}
function renderCatalog() {
  const q = $("#catSearch").value.trim().toLowerCase();
  const city = $("#catCity").value, cat = $("#catCat").value;
  const box = $("#catList");
  box.innerHTML = "";
  let items = catalogItems();
  if (city !== "הכל") items = items.filter(i => i.city === city);
  if (cat !== "הכל") items = items.filter(i => i.cat === cat);
  if (q) items = items.filter(i => (i.n + " " + (i.en || "") + " " + (i.note || "")).toLowerCase().includes(q));
  if (!items.length) box.appendChild(el("div", "cat-empty", "לא נמצא. אפשר להוסיף מקום חדש למטה ⬇"));
  items.slice(0, 120).forEach(it => {
    const c = CATS[it.cat] || CATS.site;
    const row = el("button", "cat-row");
    row.innerHTML = '<span class="s-ic">' + c.icon + "</span><span class='cr-main'><b>" + esc(it.n) + "</b>" +
      (it.note ? "<span>" + esc(it.note) + "</span>" : "") + "</span>" +
      '<span class="cr-city">' + esc(it.city) + (it.book ? " · 📌" : "") + "</span>";
    row.onclick = () => pickCatalog(it);
    box.appendChild(row);
  });
}
async function pickCatalog(it) {
  const ctx = catalogCtx;
  hideModal("catModal");
  let placeId;
  if (it.kind === "place") placeId = it.id;
  else {
    placeId = slug(it.en || it.n);
    toast("מאתר את „" + it.n + "”…", 6000);
    const geo = await geocodeClient(it.en || it.n, it.city);
    const place = {
      id: placeId, n: it.n, en: it.en || "", city: it.city, cat: it.cat,
      d: it.note || "", part: "", book: it.book ? "להזמין מראש" : "", site: "", klook: it.klook || "",
      lat: geo ? geo[0] : (CITY_CENTERS[it.city] || [35.68, 139.75])[0],
      lng: geo ? geo[1] : (CITY_CENTERS[it.city] || [35.68, 139.75])[1],
      approx: !geo,
    };
    Store.upsertPlace(place);
  }
  if (ctx.mode === "replace") Store.replaceStop(ctx.dayId, ctx.idx, placeId);
  else Store.addStop(ctx.dayId, placeId, null);
  toast(ctx.mode === "replace" ? "הוחלף ✓" : "נוסף למסלול ✓");
  if (curDay !== ctx.dayId) selectDay(ctx.dayId);
  focusStop(placeId);
}
const GEO_BBOX = {
  "טוקיו": [35.4, 36.0, 139.55, 140.05], "קיוטו": [34.85, 35.15, 135.55, 135.9],
  "אוסקה": [34.5, 34.85, 135.3, 135.65], "נארה": [34.55, 34.75, 135.7, 135.95],
  "האקונה": [35.1, 35.35, 138.9, 139.25],
};
async function geocodeClient(q, city) {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 6000);
    const r = await fetch("https://photon.komoot.io/api/?limit=3&q=" + encodeURIComponent(q + " " + (CITY_EN[city] || "Japan")), { signal: ctl.signal });
    const j = await r.json();
    const bb = GEO_BBOX[city];
    const hit = (j.features || []).find(f => {
      const [lng, lat] = f.geometry.coordinates;
      return !bb || (lat >= bb[0] && lat <= bb[1] && lng >= bb[2] && lng <= bb[3]);
    });
    if (hit) return [hit.geometry.coordinates[1], hit.geometry.coordinates[0]];
  } catch (e) { /* offline / timeout */ }
  return null;
}

/* ---------- עריכה ---------- */
let editCtx = null; // {placeId|null, dayId, idx|null}
function openEdit(placeId, dayId, idx) {
  editCtx = { placeId, dayId, idx };
  const p = placeId ? Store.getPlace(placeId) : null;
  $("#edTitle").textContent = p ? "עריכת „" + p.n + "”" : "מקום חדש";
  $("#edName").value = p ? p.n : "";
  $("#edEn").value = p ? p.en : "";
  $("#edCity").value = p ? p.city : (dayById(dayId).city.includes("←") ? "טוקיו" : dayById(dayId).city);
  $("#edCat").value = p ? p.cat : "site";
  $("#edPart").value = p ? p.part : "";
  $("#edDesc").value = p ? p.d : "";
  $("#edBook").value = p ? p.book : "";
  $("#edSite").value = p ? p.site : "";
  $("#edDay").innerHTML = DAYS.map(d => '<option value="' + d.id + '"' + (d.id === dayId ? " selected" : "") + ">יום " + d.n + " · " + d.date + " · " + esc(d.title) + "</option>").join("");
  $("#edDayWrap").style.display = idx == null && placeId == null ? "none" : "";
  showModal("edModal");
}
function saveEdit() {
  const name = $("#edName").value.trim();
  if (!name) { toast("חסר שם למקום"); return; }
  const ctx = editCtx;
  let p = ctx.placeId ? { ...Store.getPlace(ctx.placeId) } : null;
  const isNew = !p;
  if (isNew) {
    const city = $("#edCity").value;
    const cc = CITY_CENTERS[city] || [35.68, 139.75];
    p = { id: slug($("#edEn").value || name), lat: cc[0], lng: cc[1], approx: true };
  }
  Object.assign(p, {
    n: name, en: $("#edEn").value.trim(), city: $("#edCity").value, cat: $("#edCat").value,
    part: $("#edPart").value, d: $("#edDesc").value.trim(), book: $("#edBook").value.trim(), site: $("#edSite").value.trim(),
  });
  Store.upsertPlace(p);
  const newDay = $("#edDay").value;
  if (isNew) {
    Store.addStop(newDay, p.id, null);
    geocodeClient(p.en || p.n, p.city).then(geo => {
      if (geo) { Store.setCoords(p.id, geo[0], geo[1]); toast("„" + p.n + "” אותר על המפה ✓"); }
      else toast("לא הצלחתי לאתר — גררו את הסיכה ≈ למיקום הנכון");
    });
  } else if (ctx.idx != null && newDay !== ctx.dayId) {
    Store.moveStopToDay(ctx.dayId, ctx.idx, newDay);
    selectDay(newDay);
  }
  hideModal("edModal");
  toast("נשמר ✓");
}

/* ---------- טיפים והזמנות ---------- */
function renderTips() {
  const box = $("#tipsBody");
  let h = '<h3>📌 מה צריך להזמין מראש</h3><div class="booklist">';
  for (const d of DAYS) {
    for (const id of Store.dayStops(d.id)) {
      const p = Store.getPlace(id);
      if (p && p.book) h += '<div class="bookrow"><span class="dot" style="background:' + d.color + '"></span><b>יום ' + d.n + " · " + d.date + "</b> — " + esc(p.n) + ": " + esc(p.book) +
        (p.klook ? ' · <a href="' + p.klook + '" target="_blank" rel="noopener">Klook</a>' : "") + "</div>";
    }
  }
  h += "</div><h3>💡 טיפים</h3>";
  for (const t of TIPS) h += '<div class="tiprow"><b>' + esc(t.t) + "</b> — " + esc(t.d) + "</div>";
  box.innerHTML = h;
}

/* ---------- מודאלים ---------- */
function showModal(id) { $("#" + id).classList.add("open"); $("#backdrop").classList.add("open"); }
function hideModal(id) { $("#" + id).classList.remove("open"); if (!document.querySelector(".modal.open")) $("#backdrop").classList.remove("open"); }
document.addEventListener("keydown", e => {
  if (e.key === "Escape") document.querySelectorAll(".modal.open").forEach(m => hideModal(m.id));
  if ((e.ctrlKey || e.metaKey) && e.key === "z") { if (Store.undo()) toast("בוטל ↩️"); }
});

/* ---------- שיתוף / ייצוא ---------- */
async function doShare() {
  try {
    const enc = await Store.encodeShare();
    const url = location.origin + location.pathname + "#s=" + enc;
    $("#shareUrl").value = url;
    showModal("shareModal");
    try { await navigator.clipboard.writeText(url); toast("הקישור הועתק ✓"); } catch (e) { /* יוצג לבחירה ידנית */ }
  } catch (e) { toast("שגיאה ביצירת קישור"); }
}
function doExport() {
  const blob = new Blob([Store.exportJSON()], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = "japan-trip-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}
async function handleShareHash() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return;
  try {
    const d = await Store.decodeShare(decodeURIComponent(m[1]));
    const changed = Object.keys(d.dayStops || {}).length + Object.keys(d.custom || {}).length;
    const bar = $("#shareBanner");
    bar.innerHTML = '<span>🔗 נפתח קישור עם גרסה משותפת של המסלול (' + changed + " שינויים)" +
      (Store.isDirty() ? " — טעינה תחליף את השינויים המקומיים שלכם" : "") + "</span>" +
      '<button id="shApply" class="mini on">טען גרסה זו</button><button id="shSkip" class="mini">התעלם</button>';
    bar.classList.add("show");
    $("#shApply").onclick = () => { Store.applyDiff(d); bar.classList.remove("show"); history.replaceState(null, "", location.pathname); toast("הגרסה המשותפת נטענה ✓"); };
    $("#shSkip").onclick = () => { bar.classList.remove("show"); history.replaceState(null, "", location.pathname); };
  } catch (e) {
    toast("קישור השיתוף לא תקין");
    history.replaceState(null, "", location.pathname);
  }
}

/* ---------- אתחול ---------- */
function render() { renderDaybar(); renderPanel(); renderMap(); }
Store.onChange(render);

$("#btnShare").onclick = doShare;
$("#btnUndo").onclick = () => { Store.undo() ? toast("בוטל ↩️") : toast("אין מה לבטל"); };
$("#btnTips").onclick = () => { renderTips(); showModal("tipsModal"); };
$("#btnMenu").onclick = () => showModal("menuModal");
$("#mExport").onclick = () => { hideModal("menuModal"); doExport(); };
$("#mImport").onclick = () => { hideModal("menuModal"); $("#importFile").click(); };
$("#mReset").onclick = () => {
  hideModal("menuModal");
  if (confirm("לאפס את כל השינויים ולחזור למסלול המקורי?")) { Store.resetAll(); toast("אופס למסלול המקורי"); }
};
$("#importFile").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(t => { Store.importJSON(t); toast("יובא בהצלחה ✓"); }).catch(() => toast("קובץ לא תקין"));
  e.target.value = "";
};
$("#catSearch").oninput = renderCatalog;
$("#catCity").onchange = renderCatalog;
$("#catCat").onchange = renderCatalog;
$("#catNew").onclick = () => { hideModal("catModal"); openEdit(null, catalogCtx.dayId, null); };
$("#edSave").onclick = saveEdit;
$("#shareCopy").onclick = async () => {
  $("#shareUrl").select();
  try { await navigator.clipboard.writeText($("#shareUrl").value); toast("הועתק ✓"); }
  catch (e) { document.execCommand("copy"); toast("הועתק ✓"); }
};
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => hideModal(b.dataset.close));
$("#backdrop").onclick = () => document.querySelectorAll(".modal.open").forEach(m => hideModal(m.id));

render();
handleShareHash();
