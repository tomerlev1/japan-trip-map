// מעלה גרסת נכסים בכל המקומות: index.html (?v=N) + sw.js (const V)
import fs from "fs";
const n = process.argv[2];
if (!n || !/^\d+$/.test(n)) { console.error("usage: node tools/bump.mjs <version>"); process.exit(1); }
let html = fs.readFileSync("index.html", "utf8");
const cur = html.match(/\?v=(\d+)/)[1];
html = html.replaceAll("?v=" + cur, "?v=" + n);
fs.writeFileSync("index.html", html);
let sw = fs.readFileSync("sw.js", "utf8");
sw = sw.replace(/const V = "\d+";/, 'const V = "' + n + '";');
fs.writeFileSync("sw.js", sw);
console.log("bumped " + cur + " -> " + n + " (index.html + sw.js)");
