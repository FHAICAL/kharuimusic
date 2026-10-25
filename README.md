# KharuiMusic

YouTube Music web client tanpa iklan — satu codebase web, dua wadah:
**GitHub Pages (mode Lite)** dan **APK Android via Capacitor (mode Penuh)**.
Arsitektur: lihat `docs` di laporan analisa ArchiveTune (REA) & dokumen Solusi D.

Status: **D0 Spike** — aplikasi diagnostik untuk membuktikan 3 gerbang di perangkat nyata:
1. Transport native CapacitorHttp → InnerTube langsung (tanpa relay, tanpa CORS)
2. Login Google via WebView (`@capgo/inappbrowser`) → cookie sesi + verifikasi `account_menu`
3. PoToken (BgUtils) + rantai pemutaran client (WEB_REMIX → VISIONOS → ANDROID_VR → WEB → MWEB)

## Build APK debug

```bash
npm install
npm run build
npx cap sync android
# env: JAVA_HOME (JDK 21), ANDROID_HOME (SDK platform 36 + build-tools 36)
cd android && ./gradlew assembleDebug
# hasil: android/app/build/outputs/apk/debug/app-debug.apk
```

## Catatan protokol (dari analisa REA ArchiveTune v15.1.0)

- Login lengkap = cookie memuat `LOGIN_INFO` + salah satu `SAPISID`/`__Secure-3PAPISID`/`__Secure-1PAPISID`;
  auth per request: `Authorization: SAPISIDHASH <epoch>_<sha1(epoch + SAPISID + origin)>`.
- PoToken: `POST youtube.com/api/jnn/v1/Create` → jalankan BotGuard → `GenerateIT` → mint per identifier
  (visitorData = token sesi, videoId = token GVS). Implementasi memakai `bgutils-js` 3.2.0 (MIT).
- Cookie sesi tidak pernah meninggalkan perangkat pengguna.
