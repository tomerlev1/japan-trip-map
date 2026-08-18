import fs from "fs";
const rep = JSON.parse(fs.readFileSync("tools/audit-report.json", "utf8"));
const targets = rep.filter(r => !r.best || r.best.sc === 0);
const hav = (a, b) => {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2));
};
import vm from "vm";
const sb = {};
vm.runInNewContext(fs.readFileSync("js/data.js", "utf8") + "\nglobalThis.P=PLACES;", sb);
console.log("== Nominatim distance check (stored vs top EN-name result) ==");
for (const t of targets) {
  const p = sb.P[t.id];
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(p.en), { headers: { "User-Agent": "trip-map-audit/1.0" } });
    const j = await r.json();
    if (j[0]) {
      const d = Math.round(hav(t.stored, [+j[0].lat, +j[0].lon]));
      const flag = d > 400 ? "  <<<< CHECK" : "";
      console.log(`${t.id}${t.approx ? " ~" : ""} | ${d}m | ${j[0].display_name.split(",").slice(0, 3).join(",")}${flag}`);
    } else console.log(`${t.id}${t.approx ? " ~" : ""} | NO RESULT`);
  } catch (e) { console.log(t.id, "ERR"); }
  await new Promise(r => setTimeout(r, 1050));
}
