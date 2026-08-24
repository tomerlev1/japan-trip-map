/* =========================================================
   config.js — הגדרות סביבה.
   הסנכרון דורש פרויקט Supabase ייעודי (ראו tools/sync-migration.sql).
   syncUrl = כתובת הפרויקט (https://xxxx.supabase.co)
   syncKey = ה-anon/publishable key (ציבורי מעצם הגדרתו)
   ========================================================= */
window.JTM_CONFIG = Object.assign({
  syncUrl: "",
  syncKey: "",
  pollMs: 12000,
  gmapsKey: "",   // מפתח Google Maps (מוגבל-לאתר) — איתור מקומות מדויק מגוגל בהוספה ידנית
}, window.JTM_CONFIG || {});
