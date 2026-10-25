import { Capacitor } from '@capacitor/core';
import { InAppBrowser } from '@capgo/inappbrowser';
import * as YT from './innertube.js';
import { mintPoToken } from './potoken.js';

const $ = id => document.getElementById(id);
const logEl = $('log');
function log(msg) {
  const line = `[${new Date().toLocaleTimeString('id-ID')}] ${msg}`;
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
  console.log(line);
}
function gate(n, ok, label) {
  const el = $('gate' + n);
  el.textContent = label || (ok ? 'LOLOS ✓' : 'GAGAL ✗');
  el.className = ok ? 'ok' : 'bad';
}
const isNative = Capacitor.isNativePlatform();
$('chipRuntime').textContent = isNative ? `Native (${Capacitor.getPlatform()})` : 'Web (browser)';

// ---------- session ----------
const LS_KEY = 'khm_session_v1';
function saveSession(s) {
  if (s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); YT.setSession(s); }
  else { localStorage.removeItem(LS_KEY); YT.setSession(null); }
  refreshSessionChip();
}
function loadSession() {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s?.cookie) { YT.setSession(s); return s; } } catch {}
  return null;
}
function refreshSessionChip() {
  const s = YT.getSession();
  $('chipSession').textContent = s?.accountName || (s?.cookie ? 'cookie tersimpan' : 'belum login');
  $('chipSession').className = s?.cookie ? '' : 'no';
  $('chipVisitor').textContent = s?.visitorData ? s.visitorData.slice(0, 18) + '…' : '—';
  $('accountInfo').textContent = s?.accountName ? `Akun: ${s.accountName} ${s.accountEmail ? '(' + s.accountEmail + ')' : ''} ${s.accountHandle || ''}` : '';
}
saveSession(loadSession());

async function ensureVisitorData() {
  const s = YT.getSession() || {};
  if (s.visitorData) return s.visitorData;
  const { visitorData } = await YT.searchSongs('test');
  if (visitorData) { saveSession({ ...s, visitorData }); log('visitorData diperoleh dari respons search.'); }
  return visitorData;
}

// ---------- Gate 1: search / transport ----------
$('btnSearch').onclick = async () => {
  const q = $('q').value.trim();
  log(`— Cari: "${q}" (${isNative ? 'transport native CapacitorHttp' : 'fetch browser'})`);
  $('btnSearch').disabled = true;
  try {
    const { songs, visitorData } = await YT.searchSongs(q);
    if (visitorData && !YT.getSession()?.visitorData) saveSession({ ...(YT.getSession() || {}), visitorData });
    log(`Search OK: ${songs.length} lagu.`);
    gate(1, songs.length > 0);
    const box = $('results'); box.innerHTML = '';
    for (const s of songs.slice(0, 15)) {
      const b = document.createElement('button');
      b.className = 'item';
      b.innerHTML = `${s.thumb ? `<img src="${s.thumb}">` : ''}<div><div class="t"></div><div class="a"></div></div>`;
      b.querySelector('.t').textContent = s.title;
      b.querySelector('.a').textContent = s.byline || s.videoId;
      b.onclick = () => playChain(s.videoId, s.title);
      box.appendChild(b);
    }
  } catch (e) {
    log(`Search GAGAL: ${e.message} ${e.body || ''}`);
    gate(1, false);
  } finally { $('btnSearch').disabled = false; }
};

// ---------- Gate 2: login ----------
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com';
let loginPoll = null;

async function tryCompleteLogin(source) {
  try {
    const merged = {};
    for (const url of ['https://music.youtube.com', 'https://www.youtube.com', 'https://youtube.com']) {
      const c = await InAppBrowser.getCookies({ url });
      Object.assign(merged, c || {});
    }
    const cookieStr = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ');
    if (!YT.hasCompleteLoginCookies(cookieStr)) return false;
    log(`Cookie lengkap tertangkap (${source}): ${Object.keys(merged).length} cookie (LOGIN_INFO + SAPISID ada).`);
    // extract visitorData / dataSyncId from ytcfg
    await InAppBrowser.executeScript({ code: `(function(){try{var c=window.ytcfg;var y=window.yt&&window.yt.config_;var v=(c&&c.get&&c.get('VISITOR_DATA'))||(y&&y.VISITOR_DATA);var d=(c&&c.get&&c.get('DATASYNC_ID'))||(y&&y.DATASYNC_ID);if(!v||!d){var ss=document.querySelectorAll('script');for(var i=0;i<ss.length;i++){var x=ss[i].textContent||'';if(!v){var m=x.match(/["']VISITOR_DATA["']\\s*:\\s*["']([^"']+)["']/);if(m)v=m[1];}if(!d){var n=x.match(/["'](?:DATASYNC_ID|dataSyncId)["']\\s*:\\s*["']([^"']+)["']/);if(n)d=n[1];}}}window.mobileApp.postMessage({detail:{type:'ytcfg',visitorData:v||null,dataSyncId:d||null}});}catch(e){window.mobileApp.postMessage({detail:{type:'ytcfg',error:String(e)}});}})();` });
    window.__pendingCookie = cookieStr;
    return true;
  } catch (e) {
    log(`tryCompleteLogin error: ${e.message}`);
    return false;
  }
}

async function finishLogin(extra) {
  const cookie = window.__pendingCookie;
  if (!cookie) return;
  window.__pendingCookie = null;
  if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
  const s = { cookie, visitorData: extra?.visitorData || YT.getSession()?.visitorData || null, dataSyncId: extra?.dataSyncId || null };
  saveSession(s);
  log(`Sesi tersimpan. visitorData=${s.visitorData ? 'ada' : '—'} dataSyncId=${s.dataSyncId ? 'ada' : '—'}`);
  try { await InAppBrowser.close(); } catch {}
  try {
    const info = await YT.accountMenu();
    if (info.name) {
      saveSession({ ...YT.getSession(), accountName: info.name, accountEmail: info.email, accountHandle: info.handle });
      log(`Verifikasi akun OK: ${info.name} ${info.email || ''}`);
      gate(2, true);
    } else {
      log('account_menu menjawab tapi nama akun tidak ditemukan — cek log mentah. ' + JSON.stringify(info.raw).slice(0, 300));
      gate(2, false);
    }
  } catch (e) {
    log(`Verifikasi account_menu GAGAL: ${e.message} ${e.body || ''}`);
    gate(2, false);
  }
}

if (isNative) {
  InAppBrowser.addListener('messageFromWebview', e => {
    const d = e?.detail || e;
    if (d?.type === 'ytcfg') { log(`ytcfg dari WebView: visitorData=${d.visitorData ? 'ada' : '—'} dataSyncId=${d.dataSyncId ? 'ada' : '—'}`); finishLogin(d); }
  });
  InAppBrowser.addListener('browserPageLoaded', () => { tryCompleteLogin('pageLoaded'); });
  InAppBrowser.addListener('urlChangeEvent', e => { if ((e?.url || '').includes('music.youtube.com')) tryCompleteLogin('urlChange'); });
}

$('btnLogin').onclick = async () => {
  if (!isNative) { log('Login WebView hanya tersedia di APK (mode native). Di browser gunakan tempel cookie manual.'); return; }
  log('Membuka WebView login Google… silakan login seperti biasa.');
  try {
    await InAppBrowser.openWebView({ url: LOGIN_URL });
    if (loginPoll) clearInterval(loginPoll);
    loginPoll = setInterval(() => tryCompleteLogin('poll'), 3000);
  } catch (e) { log(`openWebView GAGAL: ${e.message}`); }
};
$('btnLogout').onclick = async () => {
  saveSession(null);
  if (isNative) { try { await InAppBrowser.clearAllCookies(); } catch {} }
  log('Sesi dihapus.');
  gate(2, false, 'menunggu');
};
$('btnPasteCookie').onclick = async () => {
  const cookie = $('cookiePaste').value.trim().replace(/^cookie:\s*/i, '');
  if (!YT.hasCompleteLoginCookies(cookie)) { log('Cookie tempel tidak lengkap (perlu LOGIN_INFO + SAPISID).'); return; }
  window.__pendingCookie = cookie;
  await finishLogin({});
};

// ---------- Gate 3: PoToken + playback chain ----------
async function playChain(videoId, title = '') {
  log(`— Putar ${videoId} ${title}`);
  $('nowPlaying').textContent = `Memuat ${title || videoId}…`;
  const audio = $('player');
  let lastErr = null;

  async function attempt(clientKey, { poToken = null, login = false, label = '' } = {}) {
    const client = YT.CLIENTS[clientKey];
    const json = await YT.player(videoId, client, { poToken, login });
    const status = json?.playabilityStatus?.status;
    const reason = json?.playabilityStatus?.reason || '';
    const { best, all, ciphered } = YT.pickAudioFormat(json);
    log(`  [${clientKey}${label}] status=${status} ${reason} audioFmts=${all.length}${ciphered ? ' (cipher, tak ada URL langsung)' : ''}${best?.url ? ' URL ada' : ''}`);
    if (status !== 'OK' || !best?.url) { lastErr = new Error(`${clientKey}: ${status} ${reason}`); return null; }
    return { url: best.url, itag: best.itag, mime: best.mimeType };
  }

  // 1) anonymous fallback chain (ArchiveTune order, WEB_REMIX tried with login if session exists)
  for (const key of YT.FALLBACK_ORDER) {
    try {
      const r = await attempt(key, { login: !!YT.getSession()?.cookie });
      if (r) return startAudio(r, key);
    } catch (e) { log(`  [${key}] error: ${e.message}`); lastErr = e; }
  }

  // 2) PoToken path: session token -> WEB_REMIX player
  try {
    const visitor = await ensureVisitorData();
    if (!visitor) throw new Error('visitorData tidak tersedia');
    log('Semua client anonim gagal — mencoba PoToken…');
    const sessionToken = await mintPoToken(visitor, log);
    $('chipPot').textContent = 'session ✓';
    const r = await attempt('WEB_REMIX', { poToken: sessionToken, login: !!YT.getSession()?.cookie, label: '+PoToken' });
    if (r) {
      // content-bound token for the stream URL (GVS)
      try {
        const gvs = await mintPoToken(videoId, log);
        r.url += (r.url.includes('?') ? '&' : '?') + 'pot=' + encodeURIComponent(gvs);
        log('  GVS PoToken ditempel ke URL stream.');
      } catch (e) { log(`  GVS mint gagal (lanjut tanpa): ${e.message}`); }
      return startAudio(r, 'WEB_REMIX+PoToken');
    }
  } catch (e) { log(`PoToken path GAGAL: ${e.message}`); lastErr = e; }

  $('nowPlaying').textContent = 'Gagal memutar: ' + (lastErr?.message || 'tidak diketahui');
  gate(3, false);
}

function startAudio({ url, itag, mime }, via) {
  const audio = $('player');
  audio.src = url;
  $('nowPlaying').textContent = `Diputar via ${via} · itag ${itag} · ${mime}`;
  log(`Stream dipilih (via ${via}, itag ${itag}). Menekan play…`);
  audio.play().then(() => { log('Audio PLAYING ✓'); gate(3, true); })
    .catch(e => { log(`audio.play() ditolak: ${e.message} — sentuh tombol play pada pemutar.`); });
  audio.onerror = () => { log(`Audio error: ${audio.error?.message || audio.error?.code}`); gate(3, false); };
}

$('btnPlayTest').onclick = () => playChain($('testVideoId').value.trim(), 'lagu uji');
$('btnMint').onclick = async () => {
  try {
    const visitor = await ensureVisitorData();
    const t = await mintPoToken(visitor, log);
    $('chipPot').textContent = 'mint ✓ ' + t.slice(0, 10) + '…';
    log('Tes mint PoToken: LOLOS');
  } catch (e) { log(`Tes mint PoToken GAGAL: ${e.message}`); }
};

// ---------- log tools ----------
$('btnCopyLog').onclick = async () => {
  try { await navigator.clipboard.writeText(logEl.textContent); log('(log disalin)'); }
  catch { log('Gagal menyalin otomatis — tangkap layar log ini.'); }
};
$('btnClearLog').onclick = () => { logEl.textContent = ''; };

log(`KharuiMusic D0 Spike siap. Runtime=${isNative ? 'NATIVE' : 'WEB'} platform=${Capacitor.getPlatform()}`);
if (YT.getSession()?.accountName) log(`Sesi lama ditemukan: ${YT.getSession().accountName}`);
