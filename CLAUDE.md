# japan-trip-map — הנחיות עבודה לפרויקט

מפת טיול אינטראקטיבית (יפן 10–26.09.2026 + תאילנד 26.09–13.10) לתומר ובן/בת הזוג.
**Live:** https://tomerlev1.github.io/japan-trip-map/ · **Repo:** github.com/tomerlev1/japan-trip-map (public, `main`, gh CLI authed as tomerlev1)

## חוקים קשיחים — לקרוא לפני כל שינוי
1. **כל שינוי נבדק גם בדסקטופ (1380px) וגם במובייל (390px, isMobile+hasTouch)** — תמיד שניהם, כולל צילומי מסך. בלי יוצא מן הכלל.
2. **בכל דיפלוי חובה להעלות את מספר הגרסה** `?v=N` בכל הקישורים ב-index.html (cache-busting), אחרת המשתמש רואה גרסה ישנה.
3. **אסור לגעת בבסיסי הנתונים של SkillUp ב-Supabase** (`supabase`/`supabase-prod` = ntofcpjwulypvjcsytqv, `supabase-dev` = hjgumjfrljoietbzciyl) לשום צורך של הפרויקט הזה. קרה בעבר בטעות — לא לחזור על זה.
4. **דיוק פינים = בטיחות.** מקום שלא אומת מול מקור חיצוני מסומן `approx: true` (מוצג ≈, ניתן לגרירה) — וכל קישורי הניווט שלו עובדים לפי *שם* ולא לפי קואורדינטות, כך שגוגל מפות תמיד מוביל נכון. לא להסיר approx בלי אימות (Photon/Nominatim/Overpass).
5. **אין build ואין תלויות CDN** — הכול vanilla JS + קבצים סטטיים; ספריות (Leaflet, MapLibre, פונטים) vendored בתוך הריפו.
6. אחרי כל שינוי נתונים: `node tools/validate.mjs` חייב לעבור.
7. ה-UI בעברית RTL; תוויות המפה באנגלית (השכבה הווקטורית ממירה ל-name:en/name:latin — לא לגעת בשכבות shield עם ref).

## ארכיטקטורה
```
index.html            שלד + מודאלים; גרסאות נכסים ?v=N
css/style.css         עיצוב v2 (Heebo self-hosted, RTL, bottom-sheet במובייל)
js/config.js          חיבור סנכרון אופציונלי (ריק = רדום, בלי רשת)
js/data.js            כל הנתונים: DAYS, PLACES, COORDS, CATALOG (+ll/addr/k), JA (שמות+כתובות ביפנית),
                      LUGGAGE, FLIGHTS, QUICKLINKS, EMERGENCY, TIPS, HOTELS, CITY_CENTERS
js/storage.js         מצב: localStorage, undo, דיף-שיתוף gzip+base64url, checked/visited
js/sync.js            סנכרון fetch+polling מול Supabase RPCs (רדום עד מילוי config)
js/app.js             מפה (Leaflet + MapLibre GL basemap), פאנלים, קטלוג, אוכל, GPS, מזג אוויר, מונית, companion
tools/validate.mjs    בדיקת שלמות נתונים (חובה אחרי עריכת data.js)
tools/audit.mjs       ביקורת קואורדינטות מול Photon
tools/sync-migration.sql  הפעלת סנכרון בפרויקט Supabase ייעודי חדש בלבד
```

## מצב state (v:1)
`{v, dayStops:{dayId:[placeIds]}, custom:{id:place}, checked:{id:true}, visited:{id:true}}`
- שיתוף = דיף מול ברירת המחדל, gzip+base64url ב-hash‏ (`#s=...&sync=<uuid>`)
- ולידציה סובלנית בכל טעינה; שדות חדשים חייבים fallback לערך ריק (תאימות אחורה)

## תהליך דיפלוי
1. שינוי → `node --check` לכל JS שנגעת בו → `node tools/validate.mjs`
2. בדיקת E2E מקומית (playwright-core, Chromium בקאש: `~/Library/Caches/ms-playwright/chromium-1223`) — דסקטופ + מובייל
3. העלאת `?v=N` → commit+push → המתנה לבניית Pages (`until curl | grep v=N`) → אימות על ה-live
4. עדכון קובץ הזיכרון: `~/.claude/projects/-Users-tomermac-Desktop/memory/japan-trip-map-project.md`

## עקרונות מוצר
- המשתמש רוצה לטייל *רק עם האפליקציה*: כל פיצ'ר נמדד בשימושיות בשטח (כפפות-כיס, רשת רעועה, נהג מונית יפני).
- הזמנות/מזוודות = משימות עם צ'קבוקסים; ידע = פאנל מידע; לא לערבב.
- קיצור דרך לכל החלטה: אפשר להזיז/להחליף הכול — אל תתקע תוכן, תן ברירת מחדל חכמה.
- טון עברי, חם, תמציתי. אימוג'י כן, קיטש לא.

## נשאר פתוח (לפי סדר עדיפות שהוצע למשתמש)
- 📴 Offline PWA (service worker) — טרם אושר
- 📝 הערות אישיות לכל עצירה · 🔍 חיפוש גלובלי · 🗓 תצוגת timeline יומית
- אטרקציות לתאילנד — יגיעו מהמשתמש, מתווספות דרך הקטלוג/מקום-חדש (geocode אוטומטי)
