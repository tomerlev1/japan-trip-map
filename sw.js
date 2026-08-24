/* Service Worker — מצב אופליין. הגרסה חייבת לעלות בכל דיפלוי (tools/bump.mjs) */
const V = "15";
const SHELL = "jtm-shell-" + V;
const TILES = "jtm-tiles-v1";
const ASSETS = [
  "./",
  "manifest.json",
  "icon.svg",
  "css/style.css?v=" + V,
  "js/config.js?v=" + V,
  "js/data.js?v=" + V,
  "js/storage.js?v=" + V,
  "js/sync.js?v=" + V,
  "js/app.js?v=" + V,
  "vendor/leaflet/leaflet.css?v=" + V,
  "vendor/leaflet/leaflet.js?v=" + V,
  "vendor/maplibre/maplibre-gl.css?v=" + V,
  "vendor/maplibre/maplibre-gl.js?v=" + V,
  "vendor/maplibre/leaflet-maplibre-gl.js?v=" + V,
  "vendor/fonts/heebo-hebrew.woff2",
  "vendor/fonts/heebo-latin.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith("jtm-shell-") && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

let putCount = 0;
async function trim(c) {
  if (++putCount % 300 !== 0) return;
  const keys = await c.keys();
  if (keys.length > 3500) for (const k of keys.slice(0, 700)) await c.delete(k);
}

async function cacheFirst(name, req) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r && (r.ok || r.type === "opaque")) { c.put(req, r.clone()); trim(c); }
    return r;
  } catch (err) {
    return new Response("", { status: 504, statusText: "offline" });
  }
}

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  if (url.origin === location.origin) {
    if (e.request.mode === "navigate") {
      // רשת קודם (כדי לקבל עדכונים), נפילה לקאש באופליין
      e.respondWith((async () => {
        try {
          const r = await fetch(e.request);
          const c = await caches.open(SHELL);
          c.put("./", r.clone());
          return r;
        } catch (err) {
          return (await caches.match("./")) || new Response("offline", { status: 503 });
        }
      })());
    } else {
      e.respondWith((async () => {
        const hit = await caches.match(e.request);
        if (hit) return hit;
        try {
          const r = await fetch(e.request);
          if (r.ok) { const c = await caches.open(SHELL); c.put(e.request, r.clone()); }
          return r;
        } catch (err) {
          return (await caches.match(e.request, { ignoreSearch: true })) || new Response("", { status: 504 });
        }
      })());
    }
    return;
  }

  // אריחי מפה, גליפים, ספרייטים וסגנון — cache-first (עובדים אופליין אחרי צפייה/הורדה)
  const h = url.hostname;
  if (h.endsWith("openfreemap.org") || h.endsWith("cartocdn.com")) {
    e.respondWith(cacheFirst(TILES, e.request));
    return;
  }
  // כל שאר ה-APIs (מזג אוויר, geocoding, sync) — רשת רגילה; האפליקציה יודעת להיכשל בשקט
});
