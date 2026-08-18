import fs from "fs";
import vm from "vm";
const sb = {};
vm.runInNewContext(fs.readFileSync("js/data.js", "utf8") + "\nglobalThis.P=PLACES; globalThis.C=COORDS; globalThis.D=DAYS;", sb);
const BBOX = {
  "טוקיו": [35.4, 36.0, 139.55, 140.05], "קיוטו": [34.85, 35.15, 135.55, 135.9],
  "אוסקה": [34.5, 34.85, 135.3, 135.65], "נארה": [34.55, 34.75, 135.7, 135.95],
  "האקונה": [35.05, 35.35, 138.9, 139.3],
};
const STOP = new Set(["tokyo", "kyoto", "osaka", "nara", "hakone", "shibuya", "ginza", "shinjuku", "asakusa", "ueno",
  "japan", "station", "street", "avenue", "temple", "shrine", "market", "park", "the", "at", "no", "and", "of"]);
const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w && !STOP.has(w));
function score(q, name) {
  const a = norm(q), b = new Set(norm(name));
  if (!a.length) return 0;
  return a.filter(w => b.has(w)).length / a.length;
}
const hav = (a, b) => {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2));
};
const report = [];
for (const [id, p] of Object.entries(sb.P)) {
  const bb = BBOX[p.city];
  if (!bb) continue; // Thailand handled already/verified
  const stored = sb.C[id];
  let best = null;
  try {
    const r = await fetch("https://photon.komoot.io/api/?limit=6&q=" + encodeURIComponent(p.en));
    const j = await r.json();
    for (const f of j.features || []) {
      const [lng, lat] = f.geometry.coordinates;
      if (lat < bb[0] || lat > bb[1] || lng < bb[2] || lng > bb[3]) continue;
      const sc = score(p.en, (f.properties.name || "") + " " + (f.properties.street || ""));
      const dist = Math.round(hav(stored, [lat, lng]));
      if (!best || sc > best.sc || (sc === best.sc && dist < best.dist)) best = { name: f.properties.name, t: f.properties.osm_value, ll: [+lat.toFixed(5), +lng.toFixed(5)], sc: +sc.toFixed(2), dist };
    }
  } catch (e) {}
  report.push({ id, city: p.city, approx: !!p.approx, stored, best });
  await new Promise(r => setTimeout(r, 300));
}
fs.writeFileSync("tools/audit-report.json", JSON.stringify(report, null, 1));
// summary
let exact = 0, close = 0, far = 0, none = 0;
for (const r of report) {
  if (!r.best || r.best.sc === 0) none++;
  else if (r.best.dist <= 150) exact++;
  else if (r.best.dist <= 400) close++;
  else far++;
}
console.log(`audited ${report.length}: match<=150m ${exact} · 150-400m ${close} · >400m ${far} · no-corroboration ${none}`);
console.log("\n== FLAGS (>400m with name-match, or strong-match relocation) ==");
for (const r of report) {
  if (r.best && r.best.dist > 400 && r.best.sc >= 0.5)
    console.log(`${r.id}${r.approx ? " (approx)" : ""} | stored ${r.stored} | ${r.best.dist}m -> ${r.best.name} [${r.best.t}] ${r.best.ll} sc=${r.best.sc}`);
}
console.log("\n== NO CORROBORATION ==");
for (const r of report) if (!r.best || r.best.sc === 0) console.log(`${r.id}${r.approx ? " (approx)" : ""} | ${r.city}`);
