import fs from "fs";
import vm from "vm";
const src = fs.readFileSync(new URL("../js/data.js", import.meta.url), "utf8");
const check = `
const errs = [];
for (const d of DAYS) for (const s of d.stops) {
  if (!PLACES[s]) errs.push(d.id + ": missing place " + s);
  else if (!COORDS[s]) errs.push(d.id + ": missing coords " + s);
}
for (const id in PLACES) {
  const c = COORDS[id];
  if (!c) errs.push("no coords for place " + id);
  else if (c[0] < 5 || c[0] > 46 || c[1] < 95 || c[1] > 146) errs.push("bad coords " + id + " " + c);
}
for (const id in COORDS) if (!PLACES[id]) errs.push("orphan coords " + id);
const seen = new Set();
for (const d of DAYS) { if (seen.has(d.id)) errs.push("dup day " + d.id); seen.add(d.id); }
globalThis.__out = errs.length ? "ERRORS:\\n" + errs.join("\\n")
  : "VALID: " + DAYS.length + " days, " + Object.keys(PLACES).length + " places, " + CATALOG.length + " catalog, " + TIPS.length + " tips";
globalThis.__fail = errs.length > 0;
`;
const sb = { console };
vm.runInNewContext(src + check, sb);
console.log(sb.__out);
process.exit(sb.__fail ? 1 : 0);
