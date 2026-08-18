import fs from "fs";
import vm from "vm";
const src = fs.readFileSync(new URL("../js/data.js", import.meta.url), "utf8");
const sb = {};
vm.runInNewContext(src + "\nglobalThis.P=PLACES; globalThis.C=COORDS;", sb);
const BBOX = {
  "טוקיו": [35.4, 36.0, 139.55, 140.05],
  "קיוטו": [34.85, 35.15, 135.55, 135.9],
  "אוסקה": [34.5, 34.85, 135.3, 135.65],
  "נארה": [34.55, 34.75, 135.7, 135.95],
  "האקונה": [35.1, 35.35, 138.9, 139.25],
};
const targets = Object.entries(sb.P).filter(([, p]) => p.approx).map(([id, p]) => ({ id, q: p.en, city: p.city }));
console.error("geocoding " + targets.length + " places...");
const out = {};
for (const t of targets) {
  const bb = BBOX[t.city];
  try {
    const u = "https://photon.komoot.io/api/?limit=3&q=" + encodeURIComponent(t.q);
    const r = await fetch(u, { headers: { "User-Agent": "trip-map-builder/1.0" } });
    const j = await r.json();
    const hit = (j.features || []).find(f => {
      const [lng, lat] = f.geometry.coordinates;
      return lat >= bb[0] && lat <= bb[1] && lng >= bb[2] && lng <= bb[3];
    });
    if (hit) {
      const [lng, lat] = hit.geometry.coordinates;
      out[t.id] = { lat: +lat.toFixed(5), lng: +lng.toFixed(5), name: hit.properties.name, type: hit.properties.osm_value, old: sb.C[t.id] };
    } else out[t.id] = null;
  } catch (e) { out[t.id] = { err: String(e) }; }
  await new Promise(r => setTimeout(r, 350));
}
fs.writeFileSync(new URL("./geocode-results.json", import.meta.url), JSON.stringify(out, null, 1));
const ok = Object.values(out).filter(v => v && !v.err).length;
console.error("resolved " + ok + "/" + targets.length);
