/* =========================================================
   app.js — ממשק: מפה, ימים, עצירות, עריכה, קטלוג, שיתוף
   ========================================================= */
"use strict";

const CITY_EN = { "טוקיו": "Tokyo", "קיוטו": "Kyoto", "אוסקה": "Osaka", "נארה": "Nara", "האקונה": "Hakone",
  "קראבי": "Krabi Thailand", "קופנגן": "Ko Phangan Thailand", "קוסמוי": "Ko Samui Thailand", "בנגקוק": "Bangkok Thailand" };
const PARTS = ["", "בוקר", "צהריים", "אחה\"צ", "ערב", "לילה", "כל היום"];

let curDay = null;          // null = הכל · "JP"/"TH" = סינון מדינה · אחרת מזהה יום
const IS_TOUCH = matchMedia("(pointer: coarse)").matches;
function curDayObj() { return DAYS.find(d => d.id === curDay) || null; }
function curSeg() {
  const o = curDayObj();
  if (o) return SEGMENTS.find(sg => sg.days.includes(o.id)) || null;
  if (typeof curDay === "string" && curDay.startsWith("seg:")) return SEGMENTS.find(sg => sg.id === curDay.slice(4)) || null;
  return null;
}
function curCountry() {
  if (curDay === "JP" || curDay === "TH") return curDay;
  const sg = curSeg();
  return sg ? sg.c : null;
}
function visibleDays() {
  const o = curDayObj();
  if (o) return [o];
  const sg = curSeg();
  if (sg) return DAYS.filter(d => sg.days.includes(d.id));
  if (curDay === "JP") return DAYS.filter(d => d.c !== "TH");
  if (curDay === "TH") return DAYS.filter(d => d.c === "TH");
  return DAYS;
}
function dayTitleLine(d) { return d.label ? d.label : "יום " + d.n + " · " + d.date + " · " + d.dow; }
let lastFitKey = null;
let dragIdx = null;
let catalogCtx = null;      // {mode:'add'|'replace', dayId, idx}
let TODAY_ID = todayDayId();

/* ---------- עזרים ---------- */
const $ = s => document.querySelector(s);
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function dayById(id) { return DAYS.find(d => d.id === id); }
function cityRef(p) { return (CITY_EN[p.city] || "") + (JP_CITIES.has(p.city) ? " Japan" : ""); }
function gmapsUrl(p) {
  const q = p.addr ? p.addr : (p.en || p.n) + ", " + cityRef(p);
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}
function pointRef(p) { return p.approx ? (p.en || p.n) + ", " + cityRef(p) : p.lat + "," + p.lng; }
/* יעד ניווט — כתובת מדויקת אם הוזנה; אחרת לפי שם (גוגל מזהה POI מדויק); קואורדינטות רק כשאין שם */
function destRef(p) {
  if (p.addr) return p.addr;
  if (p.en) return p.en + ", " + cityRef(p);
  if (!p.approx) return p.lat + "," + p.lng;
  return p.n + ", " + cityRef(p);
}
function navUrl(from, to) {
  return "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(pointRef(from)) +
    "&destination=" + encodeURIComponent(destRef(to)) + "&travelmode=transit";
}
function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms || 2600);
}

/* עזרי רשת ותצוגה משותפים */
function gmapsKey() { return (window.JTM_CONFIG && JTM_CONFIG.gmapsKey) || ""; }
function fetchT(url, ms, opts) {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), ms || 6000);
  return fetch(url, Object.assign({ signal: ctl.signal }, opts || {}));
}
function dayOptionsHtml(selectedId) {
  return DAYS.map(d => '<option value="' + d.id + '"' + (d.id === selectedId ? " selected" : "") + ">" + esc(dayTitleLine(d)) + "</option>").join("");
}

/* ---------- מפה ---------- */
const map = L.map("map", { zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: "bottomleft" }).addTo(map);
/* מפת בסיס: וקטורית עם תוויות באנגלית (OpenFreeMap); נפילה לרסטר אם אין WebGL */
function addRasterBasemap() {
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd", maxZoom: 20,
  }).addTo(map);
}
(async function initBasemap() {
  const webgl = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })();
  if (!webgl || typeof maplibregl === "undefined" || typeof L.maplibreGL !== "function") { addRasterBasemap(); return; }
  try {
    const st = await (await fetch("https://tiles.openfreemap.org/styles/bright")).json();
    for (const lyr of st.layers || []) {
      const tf = lyr.layout && lyr.layout["text-field"];
      if (tf && JSON.stringify(tf).includes("name")) {
        lyr.layout["text-field"] = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
      }
    }
    window.__glStyle = st;
    const gl = L.maplibreGL({
      style: st,
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    });
    gl.addTo(map);
    gl.getMaplibreMap().once("error", () => { try { map.removeLayer(gl); } catch (e) {} addRasterBasemap(); });
  } catch (e) { addRasterBasemap(); }
})();
map.setView([35.5, 137.5], 6);
const routeLayer = L.layerGroup().addTo(map);

/* ---------- שכבת "אוכל בסביבה" ---------- */
const KINDS = {
  meat: ["🥩", "בשר", "#b5542a"], sushi: ["🍣", "סושי", "#d95468"], ramen: ["🍜", "ראמן ואודון", "#e08a1e"],
  fish: ["🐟", "דגים ופירות ים", "#1878a8"], michelin: ["⭐", "מישלן ויוקרה", "#c9a227"],
  sweets: ["☕", "קפה ומתוקים", "#8d6e63"], street: ["🥡", "אוכל רחוב", "#e0621e"], market: ["🧺", "שוקי אוכל", "#c04a12"],
  other: ["🍽️", "מסעדות עוד", "#78909c"], bar: ["🍸", "ברים", "#5c6bc0"],
  vintage: ["👖", "וינטג'", "#7b5e2e"], luxury: ["💎", "יוקרה ומותגים", "#8e24aa"], mall: ["🏬", "כלבו ולייף-סטייל", "#5c6bc0"],
  fashion: ["👟", "אופנה יפנית", "#00838f"], toys: ["🕹️", "גיימינג ואנימה", "#e53935"],
  knives: ["🔪", "סכינים", "#455a64"], utensils: ["🍶", "כלי מטבח וקרמיקה", "#8d6e63"],
  culture: ["✨", "תרבות וחוויות", "#00897b"],
};
const TAXO = [
  { id: "food", he: "אוכל", icon: "🍽️", subs: ["meat", "sushi", "ramen", "fish", "michelin", "sweets", "street", "market", "other"] },
  { id: "bars", he: "ברים", icon: "🍸", subs: ["bar"] },
  { id: "shopping", he: "קניות", icon: "🛍️", subs: ["vintage", "luxury", "mall", "fashion", "toys"] },
  { id: "kitchen", he: "מטבח", icon: "🔪", subs: ["knives", "utensils"] },
  { id: "culture", he: "תרבות", icon: "✨", subs: ["culture"] },
];
let foodMarkers = {};
const foodLayer = L.layerGroup().addTo(map);
let foodOn = false, foodTop = null, foodSub = null;
function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}
function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + " מ'" : (m / 1000).toFixed(1) + ' ק"מ'; }
function foodScopeCities() {
  return new Set(visibleDays().flatMap(d => Object.keys(GEO_BBOX).filter(c => d.city.includes(c))));
}
function foodItems() {
  const cities = foodScopeCities();
  const top = TAXO.find(t => t.id === foodTop);
  return CATALOG.filter(c => c.ll && cities.has(c.city) &&
    (!top || top.subs.includes(c.k)) && (!foodSub || c.k === foodSub));
}
function foodPopup(c) {
  const box = el("div", "pop");
  let h = '<div class="pop-t">' + esc(c.n) + "</div>";
  if (c.en) h += '<div class="pop-en">' + esc(c.en) + "</div>";
  h += '<div class="pop-chips"><span class="chip">' + (KINDS[c.k] || KINDS.other)[0] + " " + (KINDS[c.k] || KINDS.other)[1] + "</span>" +
    '<span class="chip">' + esc(c.city) + "</span>" +
    (c.mich ? '<span class="chip mich">⭐ מישלן</span>' : "") + "</div>";
  if (c.note) h += '<div class="pop-d">' + esc(c.note) + "</div>";
  if (c.addr) h += '<div class="pop-dist">📍 ' + esc(c.addr) + "</div>";
  if (c.src) h += '<div class="pop-src">🗣️ ' + esc(c.src) + "</div>";
  h += c.book
    ? '<div class="pop-book">📌 כדאי להזמין מראש (דרך קבלת המלון / OMAKASE.IN)</div>'
    : '<div class="pop-walkin">🚶 הגעה ספונטנית — בלי הזמנה</div>';
  if (gpsDot) h += '<div class="pop-dist">📏 ' + fmtDist(haversine([gpsDot.getLatLng().lat, gpsDot.getLatLng().lng], c.ll)) + " מכם</div>";
  box.innerHTML = h;
  const links = el("div", "pop-links");
  links.appendChild(linkBtn("🗺️ במפות Google", "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((c.en || c.n) + ", " + (CITY_EN[c.city] || "") + " Japan")));
  links.appendChild(linkBtn("🧭 ניווט לשם עכשיו (הליכה)", "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent((c.en || c.n) + ", " + (CITY_EN[c.city] || "")) + "&travelmode=walking"));
  if (JP_CITIES.has(c.city) && c.cat === "food") links.appendChild(linkBtn("⭐ ביקורות ב-Tabelog", "https://tabelog.com/en/rstLst/?sw=" + encodeURIComponent(c.en || c.n)));
  box.appendChild(links);
  const acts = el("div", "pop-acts");
  const day = curDayObj();
  const bAdd = el("button", "mini", day ? "＋ הוסף ליום הזה" : "＋ הוסף למסלול…");
  bAdd.onclick = () => {
    map.closePopup();
    if (day) pickCatalog({ kind: "cat", n: c.n, en: c.en, city: c.city, cat: c.cat, note: c.note || "", book: !!c.book, klook: c.klook || "", src: c });
    else toast("בחרו קודם יום בסרגל למעלה, ואז הוסיפו");
  };
  acts.appendChild(bAdd);
  box.appendChild(acts);
  return box;
}
function renderFood() {
  foodLayer.clearLayers();
  foodMarkers = {};
  const bar = $("#foodbar");
  bar.style.display = foodOn ? "" : "none";
  if (!foodOn) return;
  const items = foodItems();
  // שתי שורות: קטגוריות-על, ותתי-קטגוריות כשנבחרה קטגוריה
  bar.innerHTML = "";
  const kindsHere = new Set(CATALOG.filter(c => c.ll && foodScopeCities().has(c.city)).map(c => c.k));
  const row1 = el("div", "fbrow");
  const listBtn = el("button", "fchip list", "📋 רשימה");
  listBtn.onclick = openRecList;
  row1.appendChild(listBtn);
  const all = el("button", "fchip" + (!foodTop ? " on" : ""), "הכל");
  all.onclick = () => { foodTop = null; foodSub = null; renderFood(); };
  row1.appendChild(all);
  for (const t of TAXO) {
    if (!t.subs.some(k => kindsHere.has(k))) continue;
    const b = el("button", "fchip top" + (foodTop === t.id ? " on" : ""), t.icon + " " + t.he + (foodTop === t.id ? "" : " ▾"));
    b.onclick = () => {
      if (foodTop === t.id) { foodTop = null; foodSub = null; }
      else { foodTop = t.id; foodSub = null; }
      renderFood();
    };
    row1.appendChild(b);
  }
  bar.appendChild(row1);
  const top = TAXO.find(t => t.id === foodTop);
  if (top && top.subs.length > 1) {
    const row2 = el("div", "fbrow subs");
    const allS = el("button", "fchip" + (!foodSub ? " on" : ""), "כל ה" + top.he);
    allS.onclick = () => { foodSub = null; renderFood(); };
    row2.appendChild(allS);
    for (const k of top.subs) {
      if (!kindsHere.has(k)) continue;
      const b = el("button", "fchip" + (foodSub === k ? " on" : ""), KINDS[k][0] + " " + KINDS[k][1]);
      b.onclick = () => { foodSub = foodSub === k ? null : k; renderFood(); };
      row2.appendChild(b);
    }
    bar.appendChild(row2);
  }
  if (!items.length) {
    toast(foodTop || foodSub ? "אין המלצות מהקטגוריה הזו באזור — נסו קטגוריה אחרת" : "אין עדיין המלצות שמורות לאזור הזה");
    return;
  }
  for (const c of items) {
    const kc = (KINDS[c.k] || KINDS.other)[2];
    const m = L.marker(c.ll, {
      icon: L.divIcon({ className: "", html: '<div class="fpin" style="--kc:' + kc + '">' + (KINDS[c.k] || KINDS.other)[0] + "</div>", iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -15] }),
      zIndexOffset: 650, riseOnHover: true,
    }).addTo(foodLayer);
    if (!IS_TOUCH) m.bindTooltip(c.n, { direction: "top", offset: [0, -13] });
    m.bindPopup(() => foodPopup(c), { maxWidth: 300 });
    foodMarkers[c.en || c.n] = m;
  }
}
function unpinnedItems() {
  const cities = foodScopeCities();
  const top = TAXO.find(t => t.id === foodTop);
  return CATALOG.filter(c => !c.ll && cities.has(c.city) &&
    (!top || top.subs.includes(c.k)) && (!foodSub || c.k === foodSub));
}
function openRecList() {
  const items = foodItems();
  const from = gpsDot ? [gpsDot.getLatLng().lat, gpsDot.getLatLng().lng] : [map.getCenter().lat, map.getCenter().lng];
  const rows = items.map(c => ({ c, d: haversine(from, c.ll) })).sort((a, b) => a.d - b.d);
  $("#recTitle").textContent = "המלצות באזור · " + (gpsDot ? "לפי מרחק מכם" : "לפי מרחק ממרכז המפה");
  const box = $("#recList");
  box.innerHTML = "";
  if (!rows.length) box.appendChild(el("div", "cat-empty", "אין המלצות שמורות לאזור הזה"));
  for (const { c, d } of rows) {
    const k = KINDS[c.k] || KINDS.other;
    const row = el("button", "cat-row");
    row.innerHTML = '<span class="s-ic">' + k[0] + '</span><span class="cr-main"><b>' + esc(c.n) +
      (c.mich ? " ⭐" : "") + "</b><span>" + esc(c.note || "") + (c.book ? " · 📌 בהזמנה" : " · 🚶 ספונטני") + "</span></span>" +
      '<span class="cr-city">' + fmtDist(d) + "</span>";
    row.onclick = () => {
      hideModal("recModal");
      map.flyTo(c.ll, Math.max(map.getZoom(), 16), { duration: .7 });
      const m = foodMarkers[c.en || c.n];
      if (m) setTimeout(() => m.openPopup(), 750);
    };
    box.appendChild(row);
  }
  const extra = unpinnedItems();
  if (extra.length) {
    box.appendChild(el("div", "cn-head", "🗂 עוד המלצות באזור — בלי נעיצה, ניווט לפי שם"));
    for (const c of extra) {
      const k = KINDS[c.k] || KINDS.other;
      const row = el("button", "cat-row");
      row.innerHTML = '<span class="s-ic">' + k[0] + '</span><span class="cr-main"><b>' + esc(c.n) +
        (c.mich ? " ⭐" : "") + "</b><span>" + esc(c.note || "") + (c.book ? " · 📌 בהזמנה" : "") + "</span></span>" +
        '<span class="cr-city">🗺️</span>';
      row.onclick = () => window.open("https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent((c.en || c.n) + ", " + (CITY_EN[c.city] || "")), "_blank", "noopener");
      box.appendChild(row);
    }
  }
  showModal("recModal");
}
const FoodControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd() {
    const b = L.DomUtil.create("button", "gpsbtn foodbtn");
    b.innerHTML = "🍜"; b.title = "אוכל והמלצות בסביבה";
    L.DomEvent.disableClickPropagation(b);
    L.DomEvent.on(b, "click", e => {
      L.DomEvent.stop(e);
      foodOn = !foodOn;
      b.classList.toggle("on", foodOn);
      renderFood();
      if (foodOn) toast("🍜 מציג המלצות אוכל באזור — אפשר לסנן לפי סגנון למעלה");
    });
    return b;
  },
});
map.addControl(new FoodControl());

/* ---------- מזג אוויר (Open-Meteo, ללא מפתח) ---------- */
const WX_EMOJI = c =>
  c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 57 ? "🌦️" :
  c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 81 ? "🌦️" : c === 82 ? "⛈️" : c <= 86 ? "🌨️" : "⛈️";
const GWX_EMOJI = t => /THUNDER/.test(t) ? "⛈️" : /SNOW|HAIL/.test(t) ? "🌨️" : /HEAVY_RAIN|RAIN_PERIODICALLY/.test(t) ? "🌧️" : /RAIN|SHOWER|DRIZZLE/.test(t) ? "🌦️" : t === "CLEAR" ? "☀️" : /CLEAR/.test(t) ? "🌤️" : /PARTLY/.test(t) ? "⛅" : /CLOUD|OVERCAST/.test(t) ? "☁️" : /WIND/.test(t) ? "💨" : "🌤️";
let wxCache = {};
try { wxCache = JSON.parse(localStorage.getItem("jtm.wx2") || "{}"); } catch (e) {}
function dayISO(d) {
  const t = (d.dfrom || d.date || "").split("–")[0];
  if (!/^\d\d\.\d\d$/.test(t)) return null;
  const [dd, mm] = t.split(".");
  return "2026-" + mm + "-" + dd;
}
function wxCity(d) { return Object.keys(CITY_CENTERS).find(c => d.city.includes(c)); }
async function fetchWx(city) {
  const c = wxCache[city];
  if (c && Date.now() - c.t < 3 * 3600e3) return c.d;
  const [lat, lng] = CITY_CENTERS[city];
  const u = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=16&timezone=auto";
  const r = await fetch(u);
  const j = await r.json();
  const d = {};
  (j.daily?.time || []).forEach((t, i) => {
    d[t] = { c: j.daily.weather_code[i], hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]), pp: j.daily.precipitation_probability_max[i] };
  });
  // תחזית גוגל — מחליפה את הימים שהיא מכסה (זמינה בתאילנד; ביפן אין כיסוי — רישוי JMA)
  const gkey = gmapsKey();
  if (gkey && !JP_CITIES.has(city)) {
    try {
      const gr = await fetch("https://weather.googleapis.com/v1/forecast/days:lookup?key=" + gkey +
        "&location.latitude=" + lat + "&location.longitude=" + lng + "&days=10");
      const gj = await gr.json();
      for (const f of gj.forecastDays || []) {
        const dd = f.displayDate || {};
        const iso = dd.year + "-" + String(dd.month).padStart(2, "0") + "-" + String(dd.day).padStart(2, "0");
        const day = f.daytimeForecast || {};
        d[iso] = {
          g: (day.weatherCondition && day.weatherCondition.type) || "",
          hi: Math.round((f.maxTemperature || {}).degrees),
          lo: Math.round((f.minTemperature || {}).degrees),
          pp: ((day.precipitation || {}).probability || {}).percent || 0,
        };
      }
    } catch (e) { /* offline */ }
  }
  wxCache[city] = { t: Date.now(), d };
  try { localStorage.setItem("jtm.wx2", JSON.stringify(wxCache)); } catch (e) {}
  return d;
}
function wxHtml(w) {
  return (w.g ? GWX_EMOJI(w.g) : WX_EMOJI(w.c)) + " " + w.lo + "–" + w.hi + "°" + (w.pp >= 20 ? " · 💧" + w.pp + "%" : "");
}
function fillWx(day, sel) {
  const iso = dayISO(day), city = wxCity(day);
  if (!iso || !city) return;
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const diff = (new Date(iso) - new Date(todayIso)) / 86400e3;
  if (diff < -1 || diff > 15) return;
  fetchWx(city).then(d => {
    const w = d && d[iso];
    const elm = document.querySelector(sel);
    if (w && elm) { elm.innerHTML = wxHtml(w); elm.style.display = ""; }
  }).catch(() => {});
}

/* ---------- 🚕 כרטיס לנהג מונית ---------- */
const JP_CITIES = new Set(["טוקיו", "קיוטו", "אוסקה", "נארה", "האקונה"]);
function hasTaxi(p) { return p && JP_CITIES.has(p.city); }
function openTaxi(placeId) {
  const p = Store.getPlace(placeId);
  if (!p) return;
  const ja = (typeof JA !== "undefined" && JA[placeId]) || {};
  const name = ja.n || p.jaName || "";
  const addr = ja.a || p.addr || "";
  $("#taxiName").textContent = name || addr || (p.en || p.n);
  $("#taxiAddr").textContent = name ? addr : "";
  $("#taxiHeName").textContent = p.n + (!name && !addr ? " · אין שם יפני שמור — הראו לנהג גם את הנעיצה במפה" : "");
  showModal("taxiModal");
}

/* ---------- 🧭 מלווה מסלול ---------- */
function tzForDay(d) { return d.c === "TH" ? "Asia/Bangkok" : "Asia/Tokyo"; }
function currentPart(d) {
  const h = +new Intl.DateTimeFormat("en", { timeZone: tzForDay(d), hour: "numeric", hourCycle: "h23" }).format(new Date());
  return h >= 5 && h < 11 ? "בוקר" : h >= 11 && h < 14 ? "צהריים" : h >= 14 && h < 18 ? "אחה\"צ" : h >= 18 && h < 23 ? "ערב" : "לילה";
}
function walkKm(d) {
  const ids = Store.dayStops(d.id);
  const pts = ids.map(id => Store.getPlace(id)).filter(Boolean).map(p => [p.lat, p.lng]);
  const hp = d.hotel ? Store.getPlace(d.hotel) : null;
  if (hp && !ids.includes(d.hotel)) { pts.unshift([hp.lat, hp.lng]); pts.push([hp.lat, hp.lng]); }
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    const leg = haversine(pts[i - 1], pts[i]);
    if (leg < 3000) m += leg * 1.25;
  }
  return m / 1000;
}
function updateGpsNext() {
  const elm = $("#gpsNext");
  const d = curDayObj();
  if (!elm || !d || !gpsDot) return;
  const here = [gpsDot.getLatLng().lat, gpsDot.getLatLng().lng];
  let best = null;
  for (const id of Store.dayStops(d.id)) {
    const p = Store.getPlace(id);
    if (!p) continue;
    const dist = haversine(here, [p.lat, p.lng]);
    if (!best || dist < best.dist) best = { p, dist };
  }
  if (best && best.dist < 100000) {
    elm.innerHTML = "📍 אתם ~" + fmtDist(best.dist) + " מ„" + esc(best.p.n) + "”";
    elm.style.display = "";
  }
}

/* ---------- ספירה לאחור ---------- */
function countdownHtml() {
  const now = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()) + "T12:00:00");
  const fly = new Date(TRIP.flyDate + "T12:00:00");
  const end = new Date(TRIP.endISO + "T12:00:00");
  const days = Math.round((fly - now) / 86400e3);
  if (days > 0) return '<div class="countdown">✈️ עוד <b>' + days + '</b> ימים לטיסה!</div>';
  if (now <= end) {
    const n = Math.round((now - new Date(TRIP.start + "T12:00:00")) / 86400e3) + 1;
    return '<div class="countdown">🎌 יום <b>' + n + '</b> לטיול — תהנו!</div>';
  }
  return "";
}

/* ---------- מצב "היום" (שעון יפן) ---------- */
function todayDayId(dateStr) {
  try {
    const s = dateStr || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    const [y, m, d] = s.split("-");
    if (y !== "2026") return null;
    const ser = (+m) * 100 + (+d);
    const p = t => { const [dd, mm] = t.split("."); return (+mm) * 100 + (+dd); };
    const day = DAYS.find(x => x.dfrom ? (ser >= p(x.dfrom) && ser <= p(x.dto)) : p(x.date) === ser);
    return day ? day.id : null;
  } catch (e) { return null; }
}

/* ---------- מיקום GPS ---------- */
const gpsLayer = L.layerGroup().addTo(map);
let gpsWatch = null, gpsDot = null, gpsRing = null, gpsFirstFix = false;
const GpsControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd() {
    const b = L.DomUtil.create("button", "gpsbtn");
    b.innerHTML = "📍"; b.title = "המיקום שלי על המפה"; b.setAttribute("aria-label", "המיקום שלי");
    L.DomEvent.disableClickPropagation(b);
    L.DomEvent.on(b, "click", e => { L.DomEvent.stop(e); toggleGps(); });
    this._btn = b;
    return b;
  },
});
const gpsCtl = new GpsControl();
map.addControl(gpsCtl);
function toggleGps() {
  if (gpsWatch != null) {
    navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = null; gpsDot = gpsRing = null; gpsFirstFix = false;
    gpsLayer.clearLayers();
    gpsCtl._btn.classList.remove("on");
    return;
  }
  if (!("geolocation" in navigator)) { toast("אין תמיכת מיקום בדפדפן הזה"); return; }
  gpsCtl._btn.classList.add("on");
  toast("מאתר אתכם… 📡");
  gpsWatch = navigator.geolocation.watchPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (!gpsDot) {
      gpsRing = L.circle(ll, { radius: pos.coords.accuracy || 30, color: "#1a73e8", weight: 1, opacity: .4, fillColor: "#1a73e8", fillOpacity: .12 }).addTo(gpsLayer);
      gpsDot = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="gpsdot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, keyboard: false }).addTo(gpsLayer);
    } else {
      gpsDot.setLatLng(ll); gpsRing.setLatLng(ll); gpsRing.setRadius(pos.coords.accuracy || 30);
    }
    if (!gpsFirstFix) { gpsFirstFix = true; map.flyTo(ll, Math.max(map.getZoom(), 15), { duration: .8 }); }
    updateGpsNext();
  }, err => {
    toast(err.code === 1 ? "אין הרשאת מיקום — אפשרו גישה לאתר בהגדרות הדפדפן" : "לא הצלחתי לקבל מיקום, מנסה שוב…");
    if (err.code === 1) toggleGps();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function numIcon(n, color, approx, visited) {
  return L.divIcon({
    className: "",
    html: '<div class="pin' + (approx ? " approx" : "") + (visited ? " vdone" : "") + '" style="--c:' + color + '">' + (visited ? "✓" : n) + "</div>",
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
  if (p.book) html += '<div class="pop-book' + (Store.isChecked(p.id) ? " done" : "") + '">' + (Store.isChecked(p.id) ? "✅ הוזמן! " : "📌 ") + esc(p.book) + "</div>";
  if (p.approx) html += '<div class="pop-approx">⚠️ מיקום משוער — קישור הניווט מדויק (לפי שם). אפשר לגרור את הסיכה למיקום הנכון.</div>';
  html += '<div class="gwarn"></div>';
  c.innerHTML = html;
  if (Store.isCustom(p.id)) verifyPinVsGoogle(p, c.querySelector(".gwarn"));

  const links = el("div", "pop-links");
  links.appendChild(linkBtn("🗺️ במפות Google", gmapsUrl(p)));
  if (hasTaxi(p)) {
    const tb = el("a", "lbtn");
    tb.textContent = "🚕 כרטיס לנהג מונית (ביפנית)";
    tb.href = "#"; tb.onclick = e => { e.preventDefault(); map.closePopup(); openTaxi(p.id); };
    links.appendChild(tb);
  }
  if (day && idx > 0) {
    const prev = Store.getPlace(Store.dayStops(day.id)[idx - 1]);
    if (prev) links.appendChild(linkBtn("🚇 הגעה מהעצירה הקודמת", navUrl(prev, p)));
  }
  if (p.site) links.appendChild(linkBtn("🌐 אתר רשמי", p.site));
  if (p.klook) links.appendChild(linkBtn("🎟️ Klook (קוד " + TRIP.klookCode + ")", p.klook));
  c.appendChild(links);

  if (day) {
    const acts = el("div", "pop-acts");
    const bV = el("button", "mini" + (Store.isVisited(p.id) ? " on" : ""), Store.isVisited(p.id) ? "↺ בטל \"היינו\"" : "✓ היינו כאן!");
    bV.onclick = () => { map.closePopup(); Store.toggleVisited(p.id); };
    acts.appendChild(bV);
    if (p.book) {
      const bB = el("button", "mini book", Store.isChecked(p.id) ? "↺ בטל \"הוזמן\"" : "✓ סמן שהוזמן");
      bB.onclick = () => { map.closePopup(); Store.toggleChecked(p.id); toast(Store.isChecked(p.id) ? "סומן שהוזמן ✅" : "הסימון בוטל"); };
      acts.appendChild(bB);
    }
    if (p.approx || Store.isCustom(p.id)) {
      const bG = el("button", "mini", "📍 תיקון מיקום לפי גוגל");
      bG.onclick = () => { map.closePopup(); fixPinViaGoogle(p.id); };
      acts.appendChild(bG);
    }
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

function fitOpts() {
  const mob = matchMedia("(max-width: 860px)").matches;
  const sheet = mob ? (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sheet-px")) || 0) : 0;
  return { paddingTopLeft: [34, 34], paddingBottomRight: [34, sheet + 34], maxZoom: 15 };
}
function renderMap() {
  routeLayer.clearLayers();
  const single = curDayObj();
  const days = visibleDays();
  const allPts = [];
  for (const day of days) {
    const stopIds = Store.dayStops(day.id);
    const stops = stopIds.map(id => Store.getPlace(id)).filter(Boolean);
    const latlngs = stops.map(p => [p.lat, p.lng]);
    allPts.push(...latlngs);
    const hp = day.hotel ? Store.getPlace(day.hotel) : null;
    const hotelInStops = !!(day.hotel && stopIds.includes(day.hotel));
    // קו המסלול — מתחיל במלון (נקודת ההתחלה של היום)
    const lineLL = (hp && !hotelInStops && latlngs.length ? [[hp.lat, hp.lng]] : []).concat(latlngs);
    if (lineLL.length > 1) {
      L.polyline(lineLL, { color: day.color, weight: single ? 4 : 2.5, opacity: single ? 0.85 : 0.55, dashArray: single ? null : "4 5" }).addTo(routeLayer);
    }
    // קו חזרה מקווקו מהעצירה האחרונה למלון
    if (single && hp && latlngs.length > 0 && stopIds[stopIds.length - 1] !== day.hotel) {
      L.polyline([latlngs[latlngs.length - 1], [hp.lat, hp.lng]], { color: day.color, weight: 2.5, opacity: 0.45, dashArray: "2 7" }).addTo(routeLayer);
    }
    // סמן המלון — נקודת ההתחלה
    if (single && hp && !hotelInStops) {
      allPts.push([hp.lat, hp.lng]);
      const hm = L.marker([hp.lat, hp.lng], {
        icon: L.divIcon({ className: "", html: '<div class="hpin" style="--c:' + day.color + '">🏨</div>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16] }),
        riseOnHover: true, zIndexOffset: -100,
      }).addTo(routeLayer);
      if (!IS_TOUCH) hm.bindTooltip("נקודת ההתחלה: " + hp.n, { direction: "top", offset: [0, -14] });
      hm.bindPopup(() => popupContent(Store.getPlace(hp.id) || hp, null, 0), { maxWidth: 300 });
      hm._placeId = hp.id;
    }
    stops.forEach((p, i) => {
      if (single) {
        const canDrag = !!p.approx || Store.isCustom(p.id);
        const m = L.marker([p.lat, p.lng], { icon: numIcon(i + 1, day.color, p.approx, Store.isVisited(p.id)), draggable: canDrag, riseOnHover: true }).addTo(routeLayer);
        if (!IS_TOUCH) m.bindTooltip(p.n, { direction: "top", offset: [0, -14] });
        m.bindPopup(() => popupContent(Store.getPlace(p.id) || p, day, i), { maxWidth: 300 });
        if (canDrag) m.on("dragend", () => {
          const ll = m.getLatLng();
          Store.setCoords(p.id, ll.lat, ll.lng);
          toast("המיקום של „" + p.n + "” עודכן ✓");
        });
        m._placeId = p.id;
      } else {
        const m = L.circleMarker([p.lat, p.lng], { radius: 5, color: "#fff", weight: 1.5, fillColor: day.color, fillOpacity: 1 }).addTo(routeLayer);
        if (!IS_TOUCH) m.bindTooltip(dayTitleLine(day) + " · " + p.n, { direction: "top" });
        m.on("click", () => selectDay(day.id));
      }
    });
  }
  const fitKey = curDay || "all";
  if (allPts.length && fitKey !== lastFitKey) {
    map.fitBounds(L.latLngBounds(allPts), fitOpts());
    lastFitKey = fitKey;
  }
  if (foodOn) renderFood();
}

function focusStop(placeId) {
  const p = Store.getPlace(placeId);
  if (!p) return;
  const target = L.latLng(p.lat, p.lng);
  const zoom = Math.max(map.getZoom(), 15);
  const openPopup = () => routeLayer.eachLayer(l => { if (l._placeId === placeId && l.openPopup) l.openPopup(); });
  // מרחק גדול — קפיצה בלי אנימציה: flyTo ארוך מפעיל בספארי באג ציור שמעלים את הסיכות
  if (map.getCenter().distanceTo(target) > 4000) {
    map.setView(target, zoom, { animate: false });
    setTimeout(openPopup, 80);
    return;
  }
  map.once("moveend", openPopup);
  map.flyTo(target, zoom, { duration: 0.6 });
}

/* ספארי/WebKit מפסיק לפעמים לצייר את שכבת הסמנים אחרי זום — כפיית ריענון ציור */
const IS_WEBKIT = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
if (IS_WEBKIT) map.on("zoomend moveend", () => {
  const pane = map.getPane("markerPane");
  if (!pane) return;
  const prev = pane.style.transform;
  pane.style.transform = prev ? prev + " translateZ(0)" : "translateZ(0)";
  requestAnimationFrame(() => { pane.style.transform = prev; });
});

/* ---------- סרגל ימים ---------- */
function dayChip(d) {
  const main = d.short ? esc(d.short) : "יום " + d.n;
  const b = el("button", "dchip" + (curDay === d.id ? " on" : "") + (TODAY_ID === d.id ? " today" : ""),
    '<span class="dot" style="background:' + (curDay === d.id ? "rgba(255,255,255,.9)" : d.color) + '"></span>' + main + ' <span class="dt">' + (d.dfrom || d.date) + "</span>" + (TODAY_ID === d.id ? '<span class="tdy">היום</span>' : ""));
  if (curDay === d.id) b.style.background = d.color;
  b.title = d.title;
  b.onclick = () => selectDay(d.id);
  return b;
}
function renderDaybar() {
  const bar = $("#daybar");
  bar.innerHTML = "";
  const sg = curSeg();
  const country = curCountry();
  const backChip = (label, target) => {
    const b = el("button", "dchip back", "‹ " + label);
    b.onclick = () => selectDay(target);
    bar.appendChild(b);
  };
  if (!country) {
    // רמה 1: מדינות
    const countries = [["JP", "🇯🇵 יפן"]].concat(DAYS.some(d => d.c === "TH") ? [["TH", "🇹🇭 תאילנד"]] : []);
    for (const [key, txt] of countries) {
      const b = el("button", "dchip country", txt);
      b.onclick = () => selectDay(key);
      bar.appendChild(b);
    }
    if (TODAY_ID) {
      const t = el("button", "dchip today", '🗓 היום בטיול <span class="tdy">עכשיו</span>');
      t.onclick = () => selectDay(TODAY_ID);
      bar.appendChild(t);
    }
    return;
  }
  if (!sg) {
    // רמה 2: יעדים בתוך מדינה
    backChip("כל הטיול", null);
    bar.appendChild(el("span", "dsep", country === "JP" ? "🇯🇵" : "🇹🇭"));
    for (const seg of SEGMENTS.filter(x => x.c === country)) {
      const hasToday = TODAY_ID && seg.days.includes(TODAY_ID);
      const b = el("button", "dchip seg" + (hasToday ? " today" : ""),
        "<b>" + esc(seg.n) + '</b> <span class="dt">' + esc(seg.sub) + "</span>" + (hasToday ? '<span class="tdy">היום</span>' : ""));
      b.onclick = () => selectDay("seg:" + seg.id);
      bar.appendChild(b);
    }
    return;
  }
  // רמה 3: ימים בתוך יעד
  backChip(country === "JP" ? "יפן" : "תאילנד", country);
  const sc = el("button", "dchip seg" + (curDayObj() ? "" : " on"), "<b>" + esc(sg.n) + "</b>");
  sc.onclick = () => selectDay("seg:" + sg.id);
  bar.appendChild(sc);
  bar.appendChild(el("span", "dsep", "·"));
  for (const id of sg.days) {
    const d = dayById(id);
    if (d) bar.appendChild(dayChip(d));
  }
}
function selectDay(id) {
  curDay = id;
  render();
  if (id && curDayObj()) {
    const btn = $("#daybar .dchip.on");
    if (btn) btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

/* ---------- פאנל ---------- */
function renderPanel() {
  const pn = $("#panelBody");
  pn.innerHTML = "";
  const d = curDayObj();
  if (!d) {
    const sg = curSeg();
    const country = curCountry();
    const dayRow = day => {
      const stops = Store.dayStops(day.id);
      const row = el("button", "dayrow");
      row.innerHTML = '<span class="bar" style="background:' + day.color + '"></span>' +
        '<span class="dr-main"><b>' + esc(dayTitleLine(day)) + "</b><span>" + esc(day.title) + "</span></span>" +
        '<span class="dr-city">' + esc(day.city) + " · " + stops.length + " עצירות</span>";
      row.onclick = () => selectDay(day.id);
      return row;
    };
    if (sg) {
      // רמה 3: יעד — הימים שלו
      pn.appendChild(el("div", "pn-head", "<h2>" + esc(sg.n) + "</h2><div class='pn-sub'>" + esc(sg.sub) + " · " + sg.days.length + (sg.days.length === 1 ? " יום" : " ימים") + "</div>"));
      for (const id of sg.days) { const day = dayById(id); if (day) pn.appendChild(dayRow(day)); }
      return;
    }
    if (country) {
      // רמה 2: מדינה — היעדים שלה
      pn.appendChild(el("div", "pn-head", "<h2>" + (country === "JP" ? "🇯🇵 יפן" : "🇹🇭 תאילנד") + "</h2><div class='pn-sub'>" +
        (country === "JP" ? TRIP.jpRange + " · טוקיו → קיוטו → אוסקה → נארה → האקונה → טוקיו" : TRIP.thRange + " · קראבי → קופנגן → קוסמוי → בנגקוק") + "</div>"));
      for (const seg of SEGMENTS.filter(x => x.c === country)) {
        const firstDay = dayById(seg.days[0]);
        const nStops = seg.days.reduce((a, id) => a + Store.dayStops(id).length, 0);
        const row = el("button", "dayrow");
        row.innerHTML = '<span class="bar" style="background:' + (firstDay ? firstDay.color : "#888") + '"></span>' +
          '<span class="dr-main"><b>' + esc(seg.n) + " · " + esc(seg.sub) + "</b><span>" +
          seg.days.length + (seg.days.length === 1 ? " יום" : " ימים") + " · " + nStops + " עצירות</span></span>" +
          '<span class="dr-city">' + (TODAY_ID && seg.days.includes(TODAY_ID) ? "🗓 היום" : "") + "</span>";
        row.onclick = () => selectDay("seg:" + seg.id);
        pn.appendChild(row);
      }
      return;
    }
    // רמה 1: כל הטיול — שתי מדינות
    pn.appendChild(el("div", "pn-head", "<h2>" + esc(TRIP.title) + "</h2><div class='pn-sub'>" + esc(TRIP.sub) + "</div>" + countdownHtml()));
    const jpDays = DAYS.filter(d => d.c !== "TH"), thDays = DAYS.filter(d => d.c === "TH");
    const jpMeta = jpDays[0].date + "–" + jpDays[jpDays.length - 1].date + " · " + jpDays.length + " ימים";
    const cards = [
      ["JP", "🇯🇵", "יפן", jpMeta, "טוקיו → קיוטו → אוסקה → נארה → האקונה → טוקיו", "日本"],
    ];
    if (thDays.length) {
      const thFirst = thDays[0], thLast = thDays[thDays.length - 1];
      const thCount = Math.round((thLast._e - thFirst._s) / 86400e3);
      cards.push(["TH", "🇹🇭", "תאילנד", TRIP.thRange + " · " + thCount + " ימים · " + thDays.length + " יעדים", "קראבי → קופנגן → קוסמוי → בנגקוק", "ไทย"]);
    }
    for (const [key, flag, name, meta, route, mark] of cards) {
      const row = el("button", "dayrow big");
      row.dataset.c = key;
      row.innerHTML = '<span class="dr-mark">' + mark + '</span><span class="flag">' + flag + '</span>' +
        '<span class="dr-main"><b>' + name + '</b><span class="dr-meta">' + meta + '</span><span class="dr-route">' + route + "</span></span><span class='dr-city'>›</span>";
      row.onclick = () => selectDay(key);
      pn.appendChild(row);
    }
    const hint = el("div", "pn-hint", "לחצו על מדינה ← יעד ← יום כדי לראות מסלול מפורט, לערוך ולסדר מחדש. כל שינוי נשמר — וכפתור השיתוף שולח הכול לבן/בת הזוג.");
    pn.appendChild(hint);
    return;
  }
  const head = el("div", "pn-day");
  head.innerHTML =
    '<div class="pn-nav">' +
    '<button id="navPrev" class="mini">‹ הקודם</button>' +
    '<button id="navAll" class="mini">🗺 ' + esc((curSeg() || { n: "הכל" }).n) + '</button>' +
    '<button id="navNext" class="mini">הבא ›</button></div>' +
    '<h2><span class="dot big" style="background:' + d.color + '"></span> ' + esc(dayTitleLine(d)) + "</h2>" +
    '<div class="pn-title">' + esc(d.title) + ' <span id="wxSlot" class="wx" style="display:none"></span></div>' +
    '<div class="pn-sum">' + esc(d.sum) + "</div>" +
    (d.id === TODAY_ID ? '<div class="pn-now">🕐 עכשיו ' + esc(currentPart(d)) + ' — העצירות של השעה מסומנות</div><div id="gpsNext" class="pn-gps" style="display:none"></div>' : "") +
    (walkKm(d) > 0.5 ? '<div class="pn-walk">🚶 הליכה משוערת היום: ~' + walkKm(d).toFixed(1) + ' ק"מ (בלי קטעי רכבת)</div>' : "") +
    (d.transit ? '<div class="pn-transit">🚄 ' + esc(d.transit) + "</div>" : "");
  if (d.hotel) {
    const h = Store.getPlace(d.hotel), meta = HOTELS[d.hotel];
    if (h) head.innerHTML += '<div class="pn-hotel">🏨 <a href="' + gmapsUrl(h) + '" target="_blank" rel="noopener">' + esc(h.n) + "</a>" +
      (meta ? ' · ' + esc(meta.nights) + (meta.booked ? ' <span class="ok">הוזמן ✔</span>' : "") : "") +
      (hasTaxi(h) ? ' <button class="taxibtn" data-taxi="' + esc(h.id) + '">🚕 לנהג</button>' : "") + "</div>";
  }
  for (const lug of LUGGAGE.filter(l => l.day === d.id)) {
    const ck = Store.isChecked(lug.id);
    const row = el("label", "pn-lug" + (ck ? " done" : ""));
    row.innerHTML = '<input type="checkbox"' + (ck ? " checked" : "") + '><span><b>' + esc(lug.title) + "</b> — " + esc(lug.d) + "</span>";
    row.querySelector("input").onchange = () => Store.toggleChecked(lug.id);
    head.appendChild(row);
  }
  pn.appendChild(head);
  {
    const ids = Store.dayStops(d.id);
    const v = ids.filter(id => Store.isVisited(id)).length;
    if (v > 0) {
      const pr = el("div", "dayprog");
      pr.innerHTML = '<div class="progress"><div class="progress-fill" style="width:' + Math.round(100 * v / ids.length) + '%;background:' + d.color + '"></div></div><span>' + v + "/" + ids.length + " היום ✓</span>";
      head.appendChild(pr);
    }
  }
  fillWx(d, "#wxSlot");
  const tb = head.querySelector(".taxibtn");
  if (tb) tb.onclick = e => { e.preventDefault(); openTaxi(tb.dataset.taxi); };
  const idx0 = DAYS.indexOf(d);
  head.querySelector("#navAll").onclick = () => { const sg = curSeg(); selectDay(sg ? "seg:" + sg.id : null); };
  head.querySelector("#navPrev").onclick = () => selectDay(DAYS[(idx0 - 1 + DAYS.length) % DAYS.length].id);
  head.querySelector("#navNext").onclick = () => selectDay(DAYS[(idx0 + 1) % DAYS.length].id);

  const list = el("div", "stops");
  const hp = d.hotel ? Store.getPlace(d.hotel) : null;
  const hotelInStops = !!(d.hotel && Store.dayStops(d.id).includes(d.hotel));
  if (hp && !hotelInStops) {
    const sr = el("div", "stop start");
    sr.innerHTML = '<span class="num hstart" style="border-color:' + d.color + '">🏨</span>' +
      '<span class="s-main"><b>' + esc(hp.n) + '</b><span class="s-part">נקודת ההתחלה והחזרה של היום</span></span>';
    sr.onclick = () => focusStop(hp.id);
    list.appendChild(sr);
  }
  const stops = Store.dayStops(d.id);
  stops.forEach((id, i) => {
    const p = Store.getPlace(id);
    if (!p) return;
    const cat = CATS[p.cat] || CATS.site;
    const vis = Store.isVisited(p.id);
    const row = el("div", "stop" + (d.id === TODAY_ID && p.part === currentPart(d) ? " nowpart" : "") + (vis ? " vdone" : ""));
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML =
      '<span class="num" style="background:' + d.color + '">' + (i + 1) + "</span>" +
      '<span class="s-ic">' + cat.icon + "</span>" +
      '<span class="s-main"><b>' + esc(p.n) + (p.approx ? ' <span class="approx-tag" title="מיקום משוער">≈</span>' : "") + "</b>" +
      (p.part || p.book ? '<span class="s-part">' + esc(p.part || "") +
        (p.book ? (Store.isChecked(p.id) ? ' <span class="bk done">✓ הוזמן</span>' : ' <span class="bk">📌 להזמין</span>') : "") + "</span>" : "") + "</span>" +
      '<span class="s-acts">' +
      '<button class="ib vbtn' + (vis ? " on" : "") + '" data-a="vis" title="סמן שהיינו">✓</button>' +
      '<button class="ib" data-a="up" title="הזז למעלה">▲</button>' +
      '<button class="ib" data-a="down" title="הזז למטה">▼</button>' +
      '<button class="ib" data-a="edit" title="עריכה">✎</button>' +
      '<button class="ib" data-a="swap" title="החלפה באטרקציה אחרת">⇄</button>' +
      '<button class="ib danger" data-a="del" title="הסרה">✕</button></span>';
    row.addEventListener("click", e => {
      const a = e.target.closest("button")?.dataset.a;
      if (!a) { focusStop(id); return; }
      if (a === "vis") Store.toggleVisited(id);
      else if (a === "up") Store.moveStop(d.id, i, i - 1);
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
    ? "החלפת עצירה " + (ctx.idx + 1) + " · " + dayTitleLine(day)
    : "הוספת עצירה · " + dayTitleLine(day) + " · " + day.title;
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
  const ctx = catalogCtx && dayById(catalogCtx.dayId) ? catalogCtx : { mode: "add", dayId: (curDayObj() || DAYS[0]).id, idx: null };
  catalogCtx = null;
  hideModal("catModal");
  let placeId;
  if (it.kind === "place") placeId = it.id;
  else {
    placeId = slug(it.en || it.n);
    let geo = it.src && it.src.ll ? it.src.ll : null, geoAddr = (it.src && it.src.addr) || "";
    if (!geo) {
      toast("מאתר את „" + it.n + "”…", 6000);
      const loc = await locatePlace(it.en || it.n, it.city);
      if (loc) { geo = loc.ll; geoAddr = geoAddr || loc.addr; var geoJaName = loc.jaName || ""; }
    }
    const place = {
      id: placeId, n: it.n, en: it.en || "", city: it.city, cat: it.cat,
      d: it.note || "", part: "", book: it.book ? "להזמין מראש" : "", site: "", klook: it.klook || "",
      addr: geoAddr, jaName: (typeof geoJaName !== "undefined" && geoJaName) || "",
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
  "קראבי": [7.8, 8.5, 98.5, 99.2], "קופנגן": [9.65, 9.85, 99.9, 100.15],
  "קוסמוי": [9.4, 9.62, 99.85, 100.12], "בנגקוק": [13.4, 14.05, 100.3, 100.95],
};
/* Google Places (New) — כשמוגדר מפתח ב-config: איתור ברמת גוגל-מפות + כתובת יפנית אוטומטית */
async function googlePlaces(q, city) {
  const key = gmapsKey();
  if (!key) return null;
  const bb = GEO_BBOX[city];
  try {
    const r = await fetchT("https://places.googleapis.com/v1/places:searchText", 7000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.location,places.formattedAddress,places.displayName",
      },
      body: JSON.stringify(Object.assign({
        textQuery: q + " " + (CITY_EN[city] || ""),
        languageCode: "ja",
        pageSize: 1,
      }, CITY_CENTERS[city] ? { locationBias: { circle: { center: { latitude: CITY_CENTERS[city][0], longitude: CITY_CENTERS[city][1] }, radius: 30000 } } } : {})),
    });
    const j = await r.json();
    const p = j.places && j.places[0];
    if (!p || !p.location) return null;
    const lat = p.location.latitude, lng = p.location.longitude;
    if (bb && !(lat >= bb[0] && lat <= bb[1] && lng >= bb[2] && lng <= bb[3])) return null;
    return { ll: [lat, lng], addr: (p.formattedAddress || "").replace(/^日本、?\s*/, ""), jaName: (p.displayName && p.displayName.text) || "" };
  } catch (e) { return null; }
}
/* איתור מקום לפי שם — גוגל קודם (אם יש מפתח), אחרת השרשרת החופשית */
async function locatePlace(q, city) {
  const g = await googlePlaces(q, city);
  if (g) return g;
  const ll = await geocodeClient(q, city);
  return ll ? { ll, addr: "", jaName: "" } : null;
}

/* גיאוקוד כתובת מדויקת — גוגל (אם יש מפתח) → GSI (שירות הכתובות הרשמי של יפן) → Photon */
async function geocodeAddress(addr, city) {
  const g = await googlePlaces(addr, city);
  if (g) return g.ll;
  try {
    const r = await fetchT("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(addr), 6000);
    const j = await r.json();
    const bb = GEO_BBOX[city];
    const hit = (j || []).find(f => {
      const [lng, lat] = f.geometry.coordinates;
      return !bb || (lat >= bb[0] && lat <= bb[1] && lng >= bb[2] && lng <= bb[3]);
    });
    if (hit) return [hit.geometry.coordinates[1], hit.geometry.coordinates[0]];
  } catch (e) { /* offline */ }
  return geocodeClient(addr, city);
}
const GEO_STOP = new Set(["tokyo","kyoto","osaka","nara","hakone","japan","station","the","at","no","and","of","restaurant","cafe","shop","store","bangkok","krabi","samui","phangan","thailand"]);
function geoTokens(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w && !GEO_STOP.has(w));
}
function geoScore(q, name) {
  const a = geoTokens(q), b = new Set(geoTokens(name));
  if (!a.length) return 0;
  let hit = 0; for (const w of a) if (b.has(w)) hit++;
  return hit / a.length;
}
/* גיאוקוד לפי שם — Photon עם ניקוד התאמת-שם וסינון תוצאות עיר, ואז Nominatim תחום-אזור כגיבוי.
   מחזיר null כשאין התאמה אמיתית (ואז המקום נשאר ≈ במרכז העיר — עדיף מסיכה בטוחה-אך-שגויה). */
async function geocodeClient(q, city) {
  const bb = GEO_BBOX[city];
  const inBB = (lat, lng) => !bb || (lat >= bb[0] && lat <= bb[1] && lng >= bb[2] && lng <= bb[3]);
  try {
    const r = await fetchT("https://photon.komoot.io/api/?limit=6&lang=en&q=" + encodeURIComponent(q + " " + (CITY_EN[city] || "Japan")), 6000);
    const j = await r.json();
    let best = null;
    for (const f of j.features || []) {
      const [lng, lat] = f.geometry.coordinates;
      const pr = f.properties || {};
      if (!inBB(lat, lng)) continue;
      if (pr.osm_key === "place" || pr.osm_key === "boundary") continue;
      const sc = geoScore(q, (pr.name || "") + " " + (pr.street || ""));
      if (sc >= 0.5 && (!best || sc > best.sc)) best = { ll: [lat, lng], sc };
    }
    if (best) return best.ll;
  } catch (e) { /* offline / timeout */ }
  try {
    if (bb) {
      const r = await fetchT("https://nominatim.openstreetmap.org/search?format=json&limit=6&bounded=1&viewbox=" + bb[2] + "," + bb[1] + "," + bb[3] + "," + bb[0] + "&q=" + encodeURIComponent(q), 6000);
      const j = await r.json();
      let best = null;
      for (const it of j || []) {
        const lat = +it.lat, lng = +it.lon;
        if (!inBB(lat, lng)) continue;
        if (it.class === "boundary" || it.class === "place") continue;
        const sc = geoScore(q, it.display_name || "");
        if (sc >= 0.5 && (!best || sc > best.sc)) best = { ll: [lat, lng], sc };
      }
      if (best) return best.ll;
    }
  } catch (e) { /* offline */ }
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
  $("#edAddr").value = p ? (p.addr || "") : "";
  $("#edDay").innerHTML = dayOptionsHtml(dayId);
  $("#edDayWrap").style.display = idx == null && placeId == null ? "none" : "";
  showModal("edModal");
}
function saveEdit() {
  const name = $("#edName").value.trim();
  if (!name) { toast("חסר שם למקום"); return; }
  const ctx = editCtx;
  let p = ctx.placeId ? { ...Store.getPlace(ctx.placeId) } : null;
  const isNew = !p;
  const addr = $("#edAddr").value.trim();
  const prevAddr = p ? (p.addr || "") : "";
  if (isNew) {
    const city = $("#edCity").value;
    const cc = CITY_CENTERS[city] || [35.68, 139.75];
    p = { id: slug($("#edEn").value || name), lat: cc[0], lng: cc[1], approx: true };
  }
  Object.assign(p, {
    n: name, en: $("#edEn").value.trim(), city: $("#edCity").value, cat: $("#edCat").value,
    part: $("#edPart").value, d: $("#edDesc").value.trim(), book: $("#edBook").value.trim(), site: $("#edSite").value.trim(),
    addr,
  });
  Store.upsertPlace(p);
  const newDay = $("#edDay").value;
  if (isNew) {
    Store.addStop(newDay, p.id, null);
    (addr ? geocodeAddress(addr, p.city).then(ll => ll && { ll, addr: "" }) : locatePlace(p.en || p.n, p.city)).then(geo => {
      if (geo) {
        Store.setCoords(p.id, geo.ll[0], geo.ll[1]);
        if (!addr && (geo.addr || geo.jaName)) { const cur = { ...Store.getPlace(p.id) }; if (geo.addr) cur.addr = geo.addr; if (geo.jaName) cur.jaName = geo.jaName; Store.upsertPlace(cur); }
        toast("„" + p.n + "” אותר על המפה ✓" + (addr ? " (לפי הכתובת)" : ""));
      } else toast("לא מצאתי את „" + p.n + "” במפה (≈ במרכז העיר) — פתחו עריכה ✎ והדביקו כתובת מדויקת, או גררו את הסיכה", 6000);
    });
  } else if (addr && addr !== prevAddr) {
    geocodeAddress(addr, p.city).then(geo => {
      if (geo) { Store.setCoords(p.id, geo[0], geo[1]); toast("הסיכה עודכנה לכתובת המדויקת ✓"); }
      else toast("לא הצלחתי לאתר את הכתובת — גררו את הסיכה למקום הנכון");
    });
  }
  if (!isNew && ctx.idx != null && newDay !== ctx.dayId) {
    Store.moveStopToDay(ctx.dayId, ctx.idx, newDay);
    selectDay(newDay);
  }
  hideModal("edModal");
  toast("נשמר ✓");
}

/* ---------- טיפים והזמנות ---------- */
function bookingItems() {
  const items = [];
  for (const d of DAYS) for (const id of Store.dayStops(d.id)) {
    const p = Store.getPlace(id);
    if (p && p.book) items.push({ d, p });
  }
  return items;
}
function renderTips() {
  const box = $("#tipsBody");
  const items = bookingItems();
  const done = items.filter(x => Store.isChecked(x.p.id)).length;
  const lugDone = LUGGAGE.filter(l => Store.isChecked(l.id)).length;
  const total = items.length + LUGGAGE.length, totDone = done + lugDone;
  let h = '<div class="progress"><div class="progress-fill" style="width:' + Math.round(100 * totDone / total) + '%"></div></div>' +
    '<div class="prog-txt">בוצעו ' + totDone + ' מתוך ' + total + ' משימות</div>' +
    '<h3>📌 מה צריך להזמין מראש <span class="bkcount">' + done + "/" + items.length + ' הוזמנו</span></h3><div class="booklist">';
  for (const { d, p } of items) {
    const ck = Store.isChecked(p.id);
    h += '<label class="bookrow' + (ck ? " done" : "") + '">' +
      '<input type="checkbox" data-pid="' + esc(p.id) + '"' + (ck ? " checked" : "") + '>' +
      '<span class="dot" style="background:' + d.color + '"></span>' +
      '<span class="bk-main"><b>' + esc(d.label || ("יום " + d.n + " · " + d.date)) + "</b> — " + esc(p.n) + ": " + esc(p.book) +
      (p.klook ? ' · <a href="' + p.klook + '" target="_blank" rel="noopener">Klook</a>' : "") + "</span></label>";
  }
  h += "</div><h3>🧳 שליחת מזוודות (Takkyubin)</h3><div class='booklist'>";
  for (const lug of LUGGAGE) {
    const d2 = dayById(lug.day);
    const ck = Store.isChecked(lug.id);
    h += '<label class="bookrow' + (ck ? " done" : "") + '">' +
      '<input type="checkbox" data-pid="' + esc(lug.id) + '"' + (ck ? " checked" : "") + '>' +
      '<span class="dot" style="background:' + d2.color + '"></span>' +
      '<span class="bk-main"><b>יום ' + d2.n + " · " + d2.date + "</b> — " + esc(lug.title) + ": " + esc(lug.d) + "</span></label>";
  }
  h += "</div>";
  box.innerHTML = h;
  box.querySelectorAll("input[data-pid]").forEach(cb => {
    cb.onchange = () => { Store.toggleChecked(cb.dataset.pid); renderTips(); };
  });
}
function renderInfo() {
  const box = $("#infoBody");
  let h = "<h3>💡 טיפים מהחוברת</h3>";
  for (const t of TIPS) h += '<div class="tiprow"><b>' + esc(t.t) + "</b> — " + esc(t.d) + "</div>";
  h += "<h3>✈️ הטיסות שלנו</h3><div class='booklist'>";
  for (const f of FLIGHTS) h += '<div class="bookrow"><span class="bk-main"><b>' + esc(f.r) + "</b> · " + esc(f.d) + '<br><span class="fl-note">' + esc(f.note) + "</span></span></div>";
  h += "</div><h3>🔗 קישורים מהירים</h3><div class='qlinks'>";
  for (const q of QUICKLINKS) h += '<a class="lbtn" target="_blank" rel="noopener" href="' + q.u + '">' + esc(q.t) + "</a>";
  h += "</div><h3>🆘 חירום (לוודא לפני היציאה)</h3>";
  for (const e2 of EMERGENCY) {
    h += '<div class="tiprow"><b>' + esc(e2.t) + "</b> — " + e2.items.map(esc).join(" · ") + "</div>";
  }
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
    const url = location.origin + location.pathname + "#s=" + enc + (Sync.roomId() ? "&sync=" + Sync.roomId() : "");
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
  const h = location.hash.slice(1);
  if (!h) return;
  const params = new URLSearchParams(h);
  const enc = params.get("s");
  const syncId = params.get("sync");
  if (!enc && !syncId) return;
  if (syncId && /^[0-9a-f-]{36}$/.test(syncId) && Sync.configured() && Sync.roomId() !== syncId) {
    const bar = $("#shareBanner");
    bar.innerHTML = '<span>🔗 קיבלתם קישור למסלול משותף עם סנכרון חי' +
      (Store.isDirty() ? " — ההצטרפות תחליף את השינויים המקומיים שלכם" : "") + "</span>" +
      '<button id="shApply" class="mini on">☁️ הצטרפו לסנכרון</button><button id="shSkip" class="mini">התעלם</button>';
    bar.classList.add("show");
    $("#shApply").onclick = async () => {
      try {
        await Sync.join(syncId);
        bar.classList.remove("show");
        history.replaceState(null, "", location.pathname);
        toast("מחוברים! מעכשיו כל שינוי מסתנכרן בין המכשירים ☁️✓", 3500);
      } catch (e) { toast("החיבור נכשל — בדקו אינטרנט ונסו שוב"); }
    };
    $("#shSkip").onclick = () => { bar.classList.remove("show"); history.replaceState(null, "", location.pathname); };
    return;
  }
  if (!enc) { history.replaceState(null, "", location.pathname); return; }
  try {
    const d = await Store.decodeShare(decodeURIComponent(enc));
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

/* ---------- סנכרון: ממשק ---------- */
const SYNC_LABELS = { off: "כבוי", noconfig: "לא מוגדר", ok: "מסונכרן", syncing: "מסנכרן…", error: "שגיאה" };
function updateSyncDot(st) {
  const d = $("#syncDot");
  if (d) d.className = "sdot " + st;
  const t = $("#btnSync");
  if (t) t.title = "סנכרון חי: " + (SYNC_LABELS[st] || st);
}
function renderSyncModal() {
  const box = $("#syncBody");
  const st = Sync.getStatus();
  if (!Sync.configured()) {
    box.innerHTML = '<p>☁️ הסנכרון החי עדיין לא הופעל — צריך לחבר פרויקט Supabase ייעודי (חינמי).</p>' +
      '<p class="hint">בינתיים אפשר לשתף עם כפתור 🔗 — זה עובד מצוין, רק לא מתעדכן לבד.</p>';
    return;
  }
  if (!Sync.roomId()) {
    box.innerHTML = '<p>סנכרון חי מעדכן את המסלול אוטומטית בין המכשירים של שניכם.</p>';
    const b = el("button", "addbtn", "☁️ הפעלת סנכרון למכשיר הזה");
    b.onclick = async () => {
      b.disabled = true;
      try {
        await Sync.createRoom();
        renderSyncModal();
        toast("הסנכרון פעיל! עכשיו שלחו קישור לשותף/ה 🔗", 3500);
      } catch (e) { b.disabled = false; toast("יצירת הסנכרון נכשלה — בדקו אינטרנט"); }
    };
    box.innerHTML += "";
    box.appendChild(b);
    return;
  }
  box.innerHTML = '<p>☁️ <b>הסנכרון פעיל</b> — סטטוס: ' + (SYNC_LABELS[st] || st) +
    '</p><p class="hint">מזהה חדר: <code>' + esc(Sync.roomId().slice(0, 8)) + '…</code> · כל שינוי נשלח אוטומטית ומתעדכן אצל השותף/ה תוך שניות.</p>';
  const share = el("button", "addbtn", "🔗 שליחת קישור הצטרפות לשותף/ה");
  share.onclick = () => { hideModal("syncModal"); doShare(); };
  const off = el("button", "menubtn danger", "ניתוק המכשיר הזה מהסנכרון");
  off.style.marginTop = "8px";
  off.onclick = () => { Sync.disconnect(); renderSyncModal(); toast("המכשיר נותק מהסנכרון"); };
  box.append(share, off);
}

/* ---------- אתחול ---------- */
function render() {
  applyTripDates(Store.getDates());
  TODAY_ID = todayDayId();
  const h1 = document.querySelector("header h1"); if (h1) h1.textContent = TRIP.title;
  const tg = document.querySelector("header .tag");
  if (tg) tg.textContent = TRIP.fullRange + " · " + (DAYS.some(d => d.c === "TH") ? "יפן 🇯🇵 ← תאילנד 🇹🇭" : "🇯🇵 יפן");
  renderDaybar(); renderPanel(); renderMap();
  updateGpsNext();
  const items = bookingItems();
  const left = items.filter(x => !Store.isChecked(x.p.id)).length + LUGGAGE.filter(l => !Store.isChecked(l.id)).length;
  const badge = $("#bkBadge");
  if (badge) { badge.textContent = left || ""; badge.style.display = left ? "" : "none"; }
}
Store.onChange(render);
Sync.init(updateSyncDot);
if (Sync.configured()) $("#btnSync").hidden = false;
$("#btnSync").onclick = () => { renderSyncModal(); showModal("syncModal"); };

$("#btnShare").onclick = doShare;
$("#btnUndo").onclick = () => { Store.undo() ? toast("בוטל ↩️") : toast("אין מה לבטל"); };
$("#btnTips").onclick = () => { renderTips(); showModal("tipsModal"); };
$("#btnInfo").onclick = () => { renderInfo(); showModal("infoModal"); };
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
function openDates() {
  $("#dtStart").value = TRIP.start;
  $("#dtFly").value = TRIP.flyDate;
  const box = $("#dtNights");
  box.innerHTML = "";
  for (const d of DAYS) {
    if (!d._baseNights) continue;
    const row = el("div", "dt-row");
    row.dataset.day = d.id;
    row.innerHTML = '<span class="dt-name"><b>' + esc(d.ln || d.city) + '</b> · ' + esc(d.title) + '</span>' +
      '<span class="dt-ctl"><button class="ib" data-a="minus">−</button><b class="dt-n">' + d.nights + '</b><button class="ib" data-a="plus">＋</button><span class="dt-lbl">לילות</span></span>';
    row.querySelector('[data-a="minus"]').onclick = () => { const b = row.querySelector(".dt-n"); b.textContent = Math.max(1, +b.textContent - 1); };
    row.querySelector('[data-a="plus"]').onclick = () => { const b = row.querySelector(".dt-n"); b.textContent = Math.min(30, +b.textContent + 1); };
    box.appendChild(row);
  }
  showModal("datesModal");
}
/* 📍 אימות ותיקון סיכות מול גוגל */
let gchk = {};
try { gchk = JSON.parse(localStorage.getItem("jtm.gchk") || "{}"); } catch (e) {}
function gchkKey(p) { return p.lat.toFixed(4) + "," + p.lng.toFixed(4); }
function gchkSave(id, p, dist) {
  gchk[id] = { k: gchkKey(p), d: dist, t: Date.now() };
  try { localStorage.setItem("jtm.gchk", JSON.stringify(gchk)); } catch (e) {}
}
function fmtDist(d) { return d >= 1000 ? (d / 1000).toFixed(1) + " ק״מ" : d + " מ'"; }
/* בדיקה שקטה בפתיחת כרטיסייה: אם גוגל חולק על המיקום — הערה + כפתור תיקון (נשמר בקאש לכל מיקום) */
async function verifyPinVsGoogle(p, slot) {
  if (!slot || !(window.JTM_CONFIG && JTM_CONFIG.gmapsKey)) return;
  const cached = gchk[p.id];
  let dist;
  if (cached && cached.k === gchkKey(p)) dist = cached.d;
  else {
    const g = await googlePlaces(p.addr || p.en || p.n, p.city);
    dist = g ? Math.round(haversine([p.lat, p.lng], g.ll)) : -1;
    gchkSave(p.id, p, dist);
  }
  if (dist > 150) {
    slot.innerHTML = '<div class="pop-approx">⚠️ לפי גוגל המקום נמצא ~' + fmtDist(dist) + ' מהסיכה — לחצו "📍 תיקון מיקום לפי גוגל"</div>';
  }
}
async function fixPinViaGoogle(placeId) {
  const p = Store.getPlace(placeId);
  if (!p) return;
  toast("🔍 בודק את „" + p.n + "” מול גוגל…", 6000);
  const g = await googlePlaces(p.addr || p.en || p.n, p.city);
  if (!g) { toast("גוגל לא מצא את המקום — הוסיפו כתובת בעריכה ✎ ונסו שוב"); return; }
  const d = Math.round(haversine([p.lat, p.lng], g.ll));
  if (d <= 60) { gchkSave(placeId, p, d); toast("✓ הסיכה כבר תואמת לגוגל (סטייה " + d + " מ')"); return; }
  if (!confirm("גוגל ממקם את „" + p.n + "” במרחק " + fmtDist(d) + " מהסיכה הנוכחית. לעדכן למיקום של גוגל?")) return;
  const cur = { ...p };
  cur.lat = +g.ll[0].toFixed(5); cur.lng = +g.ll[1].toFixed(5); cur.approx = false;
  if (g.addr && !cur.addr) cur.addr = g.addr;
  if (g.jaName && !cur.jaName) cur.jaName = g.jaName;
  Store.upsertPlace(cur);
  gchkSave(placeId, cur, 0);
  toast("📍 „" + p.n + "” עודכן למיקום של גוגל ✓");
}

/* 🧭 בדיקת מקומות שהוסיף המשתמש — מאמת סיכות מול הכתובות השמורות */
async function runPinAudit() {
  const body = $("#auditBody");
  body.innerHTML = "<p class='hint'>בודק את המקומות שהוספתם מול הכתובות…</p>";
  showModal("auditModal");
  const inTrip = new Set();
  for (const d of DAYS) for (const id of Store.dayStops(d.id)) inTrip.add(id);
  const customs = Object.entries(Store.snapshotState().custom).filter(([id]) => inTrip.has(id));
  if (!customs.length) { body.innerHTML = "<p>לא נמצאו מקומות שהוספתם או ערכתם — הכול מהמסלול המקורי ✓</p>"; return; }
  body.innerHTML = "";
  for (const [id, p] of customs) {
    const row = el("div", "aud-row");
    let html = "<b>" + esc(p.n) + "</b><span class='aud-city'>" + esc(p.city) + "</span><div class='aud-st'>";
    const cc = CITY_CENTERS[p.city];
    const atCenter = cc && haversine([p.lat, p.lng], cc) < 40;
    if (p.addr) {
      row.innerHTML = html + "⏳ בודק מול הכתובת…</div>";
      body.appendChild(row);
      const geo = await geocodeAddress(p.addr, p.city);
      if (geo) {
        const d = Math.round(haversine([p.lat, p.lng], geo));
        if (d > 150) {
          row.querySelector(".aud-st").innerHTML = "⚠️ הסיכה רחוקה ~" + d + " מ' מהכתובת השמורה ";
          const fix = el("button", "mini", "תקן לפי הכתובת");
          fix.onclick = () => { Store.setCoords(id, geo[0], geo[1]); row.querySelector(".aud-st").textContent = "✓ תוקן לפי הכתובת"; };
          row.querySelector(".aud-st").appendChild(fix);
        } else row.querySelector(".aud-st").textContent = "✓ תואם לכתובת השמורה (" + d + " מ')";
      } else row.querySelector(".aud-st").textContent = "❔ הכתובת השמורה לא אותרה — ודאו מול גוגל או עגנו ב-GPS";
      continue;
    }
    if (atCenter) html += "⚠️ לא אותר במפות — הסיכה במרכז העיר. פתחו עריכה ✎ והדביקו כתובת, או עגנו ב-GPS כשתהיו שם";
    else html += "🖐 מוקם ידנית או לפי שם — אין כתובת לאימות. מומלץ להוסיף כתובת בעריכה ✎";
    row.innerHTML = html + "</div>";
    body.appendChild(row);
  }
}
/* 🔍 חיפוש מקום דרך גוגל מתוך המפה */
async function googleSearchList(q) {
  const key = gmapsKey();
  if (!key) return null;
  const ctr = map.getCenter();
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.location,places.formattedAddress,places.displayName,places.types,places.rating,places.userRatingCount" },
    body: JSON.stringify({ textQuery: q, languageCode: "en", pageSize: 6,
      locationBias: { circle: { center: { latitude: ctr.lat, longitude: ctr.lng }, radius: 50000 } } }),
  });
  const j = await r.json();
  return j.places || [];
}
function cityForLatLng(lat, lng) {
  for (const [city, bb] of Object.entries(GEO_BBOX)) if (lat >= bb[0] && lat <= bb[1] && lng >= bb[2] && lng <= bb[3]) return city;
  let best = null, bd = Infinity;
  for (const [city, ll] of Object.entries(CITY_CENTERS)) { const d = haversine([lat, lng], ll); if (d < bd) { bd = d; best = city; } }
  return best;
}
let previewMarker = null;
function previewSpot(lat, lng, name) {
  if (previewMarker) map.removeLayer(previewMarker);
  previewMarker = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: '<div class="pin" style="--c:#0ea5e9">★</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
  if (name) previewMarker.bindTooltip(name);
  map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  setTimeout(() => { if (previewMarker) { map.removeLayer(previewMarker); previewMarker = null; } }, 15000);
}
async function addSearchResult(g) {
  const dayId = $("#srchDay").value;
  const lat = g.location.latitude, lng = g.location.longitude;
  const city = cityForLatLng(lat, lng);
  const en = (g.displayName && g.displayName.text) || "מקום";
  const t = g.types || [];
  const cat = t.some(x => /restaurant|food|cafe|bakery|bar|meal/.test(x)) ? "food"
    : t.includes("lodging") ? "hotel"
    : t.some(x => /store|shopping/.test(x)) ? "shop" : "site";
  const place = { id: slug(en), n: en, en, city, cat, d: "", part: "", book: "", site: "", klook: "",
    addr: (g.formattedAddress || "").replace(/^日本、?\s*/, ""), lat, lng, approx: false };
  if (JP_CITIES.has(city) && g.id) {
    try { // שם וכתובת ביפנית — לכרטיס הנהג
      const r = await fetch("https://places.googleapis.com/v1/places/" + g.id + "?languageCode=ja&fields=displayName,formattedAddress&key=" + JTM_CONFIG.gmapsKey);
      const j = await r.json();
      if (j.displayName) place.jaName = j.displayName.text;
      if (j.formattedAddress) place.addr = j.formattedAddress.replace(/^日本、?\s*/, "");
    } catch (e) {}
  }
  Store.upsertPlace(place);
  Store.addStop(dayId, place.id, null);
  hideModal("searchModal");
  toast("„" + place.n + "” נוסף למסלול ✓");
  if (curDay !== dayId) selectDay(dayId);
  focusStop(place.id);
}
async function runSearch() {
  const q = $("#srchInput").value.trim();
  if (!q) return;
  const box = $("#srchResults");
  box.innerHTML = "<p class='hint'>מחפש בגוגל…</p>";
  let list = null;
  try { list = await googleSearchList(q); } catch (e) {}
  if (!list) { box.innerHTML = "<p class='hint'>החיפוש נכשל — בדקו חיבור לאינטרנט.</p>"; return; }
  if (!list.length) { box.innerHTML = "<p class='hint'>לא נמצא. נסו שם באנגלית או כתובת מלאה.</p>"; return; }
  box.innerHTML = "";
  for (const g of list) {
    const row = el("div", "srch-row");
    row.innerHTML = "<b>" + esc((g.displayName && g.displayName.text) || "?") + "</b>" +
      (g.rating ? ' <span class="srch-rate">★ ' + g.rating + (g.userRatingCount ? " · " + g.userRatingCount + " דירוגים" : "") + "</span>" : "") +
      '<div class="srch-addr">' + esc(g.formattedAddress || "") + "</div>";
    const acts = el("div", "srch-acts");
    const bAdd = el("button", "mini on", "➕ הוסף ליום");
    bAdd.onclick = () => addSearchResult(g);
    const bMap = el("button", "mini", "👁 הצג במפה");
    bMap.onclick = () => { hideModal("searchModal"); previewSpot(g.location.latitude, g.location.longitude, (g.displayName && g.displayName.text) || ""); };
    acts.append(bAdd, bMap);
    row.appendChild(acts);
    box.appendChild(row);
  }
}
$("#btnSearch").onclick = () => {
  const sel = $("#srchDay");
  sel.innerHTML = dayOptionsHtml(curDay);
  $("#srchResults").innerHTML = "";
  showModal("searchModal");
  setTimeout(() => $("#srchInput").focus(), 60);
};
$("#srchGo").onclick = runSearch;
$("#srchInput") && $("#srchInput").addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

$("#mAudit").onclick = () => { hideModal("menuModal"); runPinAudit(); };
$("#mDates").onclick = () => { hideModal("menuModal"); openDates(); };
$("#dtSave").onclick = () => {
  const nights = {};
  document.querySelectorAll("#dtNights [data-day]").forEach(r => { nights[r.dataset.day] = +r.querySelector(".dt-n").textContent; });
  Store.setDates({ start: $("#dtStart").value || undefined, flyDate: $("#dtFly").value || undefined, nights });
  hideModal("datesModal");
  toast("🗓 התאריכים עודכנו בכל המפה ✓");
};
$("#dtReset").onclick = () => { Store.setDates(null); hideModal("datesModal"); toast("חזרנו לתאריכים המקוריים ↺"); };
$("#shareCopy").onclick = async () => {
  $("#shareUrl").select();
  try { await navigator.clipboard.writeText($("#shareUrl").value); toast("הועתק ✓"); }
  catch (e) { document.execCommand("copy"); toast("הועתק ✓"); }
};
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => hideModal(b.dataset.close));
$("#backdrop").onclick = () => document.querySelectorAll(".modal.open").forEach(m => hideModal(m.id));

/* ---------- Bottom sheet (מובייל) ---------- */
(function initSheet() {
  const panel = $("#panel"), handle = $("#sheetHandle");
  const mq = matchMedia("(max-width: 860px)");
  let snaps = [], h = 0, startY = 0, startH = 0, dragging = false;
  const setVar = px => document.documentElement.style.setProperty("--sheet-px", Math.round(px) + "px");
  function calcSnaps() {
    const H = window.innerHeight;
    snaps = [Math.round(H * 0.16), Math.round(H * 0.44), Math.round(H * 0.82)];
  }
  function apply(px, animate) {
    h = px;
    panel.style.height = Math.round(px) + "px";
    setVar(px);
    if (animate) setTimeout(() => map.invalidateSize({ pan: false }), 270);
    else map.invalidateSize({ pan: false });
  }
  handle.addEventListener("pointerdown", e => {
    if (!mq.matches) return;
    dragging = true; startY = e.clientY; startH = h;
    panel.style.transition = "none";
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", e => {
    if (!dragging) return;
    const nh = Math.min(window.innerHeight * 0.9, Math.max(80, startH + (startY - e.clientY)));
    h = nh; panel.style.height = nh + "px"; setVar(nh);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = "";
    apply(snaps.reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a), true);
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  function onMode() {
    if (mq.matches) { calcSnaps(); apply(snaps[1], false); }
    else { panel.style.height = ""; setVar(0); map.invalidateSize({ pan: false }); }
  }
  addEventListener("resize", () => { if (mq.matches) { calcSnaps(); } });
  addEventListener("orientationchange", () => setTimeout(onMode, 250));
  mq.addEventListener ? mq.addEventListener("change", onMode) : mq.addListener(onMode);
  onMode();
})();

/* ---------- 📴 אופליין: Service Worker + הורדת אזורי הטיול ---------- */
function lon2tile(lng, z) { return Math.floor((lng + 180) / 360 * 2 ** z); }
function lat2tile(lat, z) {
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
}
async function preloadOffline() {
  if (!("caches" in window) || !("serviceWorker" in navigator)) { toast("הדפדפן לא תומך באחסון אופליין"); return; }
  if (!navigator.serviceWorker.controller) { toast("רעננו את הדף פעם אחת ואז נסו שוב"); return; }
  const st = window.__glStyle;
  let tpl = null, glyphs = null, stacks = new Set();
  try {
    const src = st && st.sources && (st.sources.openmaptiles || Object.values(st.sources).find(x => x.type === "vector"));
    if (src) {
      if (src.tiles) tpl = src.tiles[0];
      else if (src.url) { const tj = await (await fetch(src.url)).json(); tpl = tj.tiles && tj.tiles[0]; }
    }
    glyphs = st && st.glyphs;
    for (const l of (st && st.layers) || []) {
      const f = l.layout && l.layout["text-font"];
      if (Array.isArray(f)) f.forEach(x => { if (typeof x === "string") stacks.add(x); });
    }
  } catch (e) {}
  if (!tpl) { toast("המפה עוד לא נטענה — חכו רגע ונסו שוב"); return; }
  const cap = (window.JTM_CONFIG && JTM_CONFIG.preloadCap) || 2200;
  const want = new Set();
  const add = (x, y, z) => { if (x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z) want.add(z + "/" + x + "/" + y); };
  for (const bb of Object.values(GEO_BBOX)) {
    for (let z = 10; z <= 12; z++) {
      const x1 = lon2tile(bb[2], z), x2 = lon2tile(bb[3], z), y1 = lat2tile(bb[1], z), y2 = lat2tile(bb[0], z);
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) add(x, y, z);
    }
  }
  for (const [la, lo] of Object.values(COORDS)) {
    for (const [z, r] of [[13, 2], [14, 1]]) {
      const cx = lon2tile(lo, z), cy = lat2tile(la, z);
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) add(x, y, z);
    }
  }
  let list = [...want].slice(0, cap);
  // גליפים לכל fontstack (לטינית בסיסית) + ספרייט — כדי שתוויות יעבדו גם באזור שלא נצפה
  const extra = [];
  if (glyphs) for (const fs of stacks) for (const rg of ["0-255", "256-511", "512-767"])
    extra.push(glyphs.replace("{fontstack}", encodeURIComponent(fs)).replace("{range}", rg));
  if (st && st.sprite) extra.push(st.sprite + ".json", st.sprite + ".png", st.sprite + "@2x.json", st.sprite + "@2x.png");
  toast("📥 מוריד את מפות הטיול (" + list.length + " אריחים) — השאירו את הדף פתוח…", 6000);
  let done = 0, fail = 0;
  const q = [...extra.map(u => ["url", u]), ...list.map(k => ["tile", k])];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const [kind, v] = q.pop();
      const u = kind === "url" ? v : (() => { const [z, x, y] = v.split("/"); return tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y); })();
      try { await fetch(u); } catch (e) { fail++; }
      done++;
      if (done % 300 === 0) toast("📥 " + done + "/" + (list.length + extra.length) + " …", 2500);
    }
  }));
  toast(fail > list.length / 4 ? "ההורדה הושלמה חלקית (" + fail + " נכשלו) — נסו שוב על WiFi" : "✅ מפות אזורי הטיול שמורות במכשיר — המפה תעבוד גם בלי אינטרנט", 6000);
}
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  navigator.serviceWorker.register("sw.js").then(reg => {
    const first = !navigator.serviceWorker.controller;
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => {
        if (w.state === "activated" && first) toast("📴 מעכשיו האפליקציה עובדת גם בלי אינטרנט", 4500);
        else if (w.state === "activated") toast("האפליקציה התעדכנה לגרסה החדשה ✓");
      });
    });
  }).catch(() => {});
}
window.addEventListener("offline", () => toast("📴 אין אינטרנט — המסלול והמפות השמורות ממשיכים לעבוד", 4000));
window.addEventListener("online", () => toast("📶 חזרתם לרשת ✓"));
$("#mPreload").onclick = () => { hideModal("menuModal"); preloadOffline(); };

{ const vl = $("#verLine"); if (vl) vl.textContent = "גרסת אפליקציה: v" + ((document.querySelector('script[src*="app.js"]') || { src: "" }).src.split("v=")[1] || "dev"); }

/* שגיאות לא-צפויות — להציג למשתמש במקום להיכשל בשקט */
window.addEventListener("error", e => { try { toast("⚠️ תקלה: " + (e.message || "שגיאה לא ידועה")); } catch (_) {} });
window.addEventListener("unhandledrejection", e => { try { toast("⚠️ תקלה: " + ((e.reason && e.reason.message) || e.reason || "שגיאה לא ידועה")); } catch (_) {} });

if (TODAY_ID && !location.hash) {
  curDay = TODAY_ID;
  setTimeout(() => toast("🗓 קוניצ'יווה! נטען אוטומטית היום במסלול — יום " + dayById(TODAY_ID).n + ": " + dayById(TODAY_ID).title, 4000), 400);
}
render();
handleShareHash();
