import './style.css';
import { Capacitor } from '@capacitor/core';
import { InAppBrowser } from '@capgo/inappbrowser';
import * as YT from './innertube.js';
import { mintPoToken } from './potoken.js';
import { Player } from './player.js';

const $ = id => document.getElementById(id);
const isNative = Capacitor.isNativePlatform();

// ---------- log (diagnostics drawer) ----------
const logEl = $('log');
function log(msg) {
  const line = `[${new Date().toLocaleTimeString('id-ID')}] ${msg}`;
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
  console.log(line);
}
$('btnLog').onclick = () => { $('logDrawer').hidden = false; };
$('btnCloseLog').onclick = () => { $('logDrawer').hidden = true; };
$('btnCopyLog').onclick = async () => {
  try { await navigator.clipboard.writeText(logEl.textContent); log('(log disalin)'); }
  catch { log('Gagal menyalin otomatis — tangkap layar log ini.'); }
};
$('btnClearLog').onclick = () => { logEl.textContent = ''; };

// ---------- session ----------
const LS_KEY = 'khm_session_v1';
function saveSession(s) {
  if (s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); YT.setSession(s); }
  else { localStorage.removeItem(LS_KEY); YT.setSession(null); }
  refreshAccountUI();
}
function loadSession() {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s?.cookie) { YT.setSession(s); return s; } } catch {}
  return null;
}
function refreshAccountUI() {
  const s = YT.getSession();
  const name = s?.accountName;
  $('btnAccount').textContent = name ? name.split(' ')[0] : (s?.cookie ? 'Akun' : 'Masuk');
  $('accountInfo').textContent = s?.cookie
    ? `Masuk sebagai ${name || '—'} ${s.accountEmail ? '(' + s.accountEmail + ')' : ''} ${s.accountHandle || ''}`
    : 'Belum masuk. Login memberi akses Library (playlist & lagu yang disukai).';
}
saveSession(loadSession());

// Backfill ytcfg for older sessions (no re-login needed).
(async () => {
  const s = YT.getSession();
  if (s?.cookie && (!s.visitorData || !s.dataSyncId)) {
    try {
      const h = await YT.fetchYtcfgFromHtml();
      if (h.visitorData || h.dataSyncId) {
        saveSession({ ...s, visitorData: s.visitorData || h.visitorData, dataSyncId: s.dataSyncId || h.dataSyncId });
        log(`ytcfg sesi dilengkapi via HTML: visitorData=${h.visitorData ? 'ada' : '—'} dataSyncId=${h.dataSyncId ? 'ada' : '—'}`);
      }
    } catch (e) { log(`Backfill ytcfg gagal: ${e.message}`); }
  }
})();

async function ensureVisitorData() {
  const s = YT.getSession() || {};
  if (s.visitorData) return s.visitorData;
  const { visitorData } = await YT.searchSongs('test');
  if (visitorData) saveSession({ ...s, visitorData });
  return visitorData;
}

// ---------- stream resolution (D0-proven chain) ----------
async function resolveStream(videoId) {
  let lastErr = null;
  async function attempt(clientKey, { poToken = null, login = false } = {}) {
    const client = YT.CLIENTS[clientKey];
    const json = await YT.player(videoId, client, { poToken, login });
    const status = json?.playabilityStatus?.status;
    const reason = json?.playabilityStatus?.reason || '';
    const { best, all } = YT.pickAudioFormat(json);
    log(`  [${clientKey}] status=${status} ${reason} fmts=${all.length}${best?.url ? ' URL ada' : ''}`);
    if (status !== 'OK' || !best?.url) { lastErr = new Error(`${clientKey}: ${status} ${reason}`); return null; }
    return { url: best.url, via: clientKey };
  }
  for (const key of YT.FALLBACK_ORDER) {
    try {
      const r = await attempt(key, { login: !!YT.getSession()?.cookie });
      if (r) return r;
    } catch (e) { lastErr = e; log(`  [${key}] error: ${e.message}`); }
  }
  try {
    const visitor = await ensureVisitorData();
    if (!visitor) throw new Error('visitorData tidak tersedia');
    log('Client anonim gagal — mencoba PoToken…');
    const sessionToken = await mintPoToken(visitor, log);
    const r = await attempt('WEB_REMIX', { poToken: sessionToken, login: !!YT.getSession()?.cookie });
    if (r) {
      try {
        const gvs = await mintPoToken(videoId, log);
        r.url += (r.url.includes('?') ? '&' : '?') + 'pot=' + encodeURIComponent(gvs);
      } catch (e) { log(`  GVS mint gagal (lanjut tanpa): ${e.message}`); }
      return r;
    }
  } catch (e) { lastErr = e; log(`PoToken path GAGAL: ${e.message}`); }
  throw lastErr || new Error('tidak ada stream yang bisa diputar');
}

// ---------- player ----------
const RECENT_KEY = 'khm_recent_v1';
function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
function pushRecent(song) {
  const list = getRecent().filter(s => s.videoId !== song.videoId);
  list.unshift({ videoId: song.videoId, title: song.title, byline: song.byline, thumb: song.thumb, duration: song.duration });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  renderRecent();
}
let lastCurrentId = null;
const player = new Player($('player'), {
  resolveStream,
  onNeedMore: async song => (await YT.watchNext(song.videoId)).songs,
  log,
  onChange: st => {
    renderPlayerState(st);
    if (st.current && st.current.videoId !== lastCurrentId) {
      lastCurrentId = st.current.videoId;
      pushRecent(st.current);
      highlightPlaying();
    }
  },
});

function fmt(sec) {
  if (!isFinite(sec) || sec == null) return '0:00';
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function renderPlayerState(st) {
  const cur = st.current;
  $('miniPlayer').hidden = !cur;
  if (!cur) return;
  if (st.progressOnly) {
    $('miniProgressBar').style.width = st.duration ? (100 * st.currentTime / st.duration) + '%' : '0%';
    $('npCur').textContent = fmt(st.currentTime);
    $('npDur').textContent = fmt(st.duration);
    if (document.activeElement !== $('npSeek') && st.duration) $('npSeek').value = String(Math.round(1000 * st.currentTime / st.duration));
    return;
  }
  $('miniThumb').src = cur.thumb || '';
  $('miniTitle').textContent = cur.title || cur.videoId;
  $('miniArtist').textContent = st.loading ? 'Memuat…' : (cur.byline || '');
  $('btnMiniPlay').textContent = st.playing ? '⏸' : '▶';
  $('npThumb').src = cur.thumb || '';
  $('npTitle').textContent = cur.title || cur.videoId;
  $('npArtist').textContent = cur.byline || '';
  $('npSource').textContent = st.sourceLabel || 'KharuiMusic';
  $('btnPlay').textContent = st.playing ? '⏸' : '▶';
  $('npStatus').textContent = st.loading ? 'Memuat stream…' : '';
  $('btnShuffle').classList.toggle('on', st.shuffle);
  $('btnRepeat').classList.toggle('on', st.repeat > 0);
  $('btnRepeat').textContent = st.repeat === 2 ? '🔂' : '🔁';
  renderQueue(st);
}
function renderQueue(st) {
  const box = $('queueList'); box.innerHTML = '';
  st.queue.forEach((s, i) => box.appendChild(songRow(s, {
    playing: i === st.index,
    onTap: () => player.playAt(i),
  })));
}
function highlightPlaying() {
  document.querySelectorAll('.song[data-vid]').forEach(el => {
    el.classList.toggle('playing', el.dataset.vid === lastCurrentId);
  });
}

// ---------- song rows ----------
function songRow(song, { onTap, playing = false } = {}) {
  const b = document.createElement('button');
  b.className = 'song' + (playing ? ' playing' : '');
  b.dataset.vid = song.videoId;
  const right = [song.byline, song.duration].filter(Boolean).join(' • ');
  b.innerHTML = `${song.thumb ? `<img loading="lazy" src="${song.thumb}">` : '<img>'}<div class="meta"><div class="t"></div><div class="a"></div></div>`;
  b.querySelector('.t').textContent = song.title || song.videoId;
  b.querySelector('.a').textContent = right || song.videoId;
  b.onclick = onTap;
  return b;
}
function renderSongList(box, songs, onTapSong) {
  box.innerHTML = '';
  songs.forEach((s, i) => box.appendChild(songRow(s, {
    playing: s.videoId === lastCurrentId,
    onTap: () => onTapSong(s, i),
  })));
}

// ---------- navigation ----------
function showView(name) {
  for (const v of ['explore', 'library', 'playlist']) $('view-' + v).hidden = v !== name;
  $('navExplore').classList.toggle('active', name === 'explore');
  $('navLibrary').classList.toggle('active', name !== 'explore');
  if (name === 'library') loadLibrary();
}
$('navExplore').onclick = () => showView('explore');
$('navLibrary').onclick = () => showView('library');

// ---------- explore / search ----------
async function doSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  $('resultsTitle').textContent = `Hasil untuk "${q}"`;
  $('homeSections').hidden = true;
  $('resultsWrap').hidden = false;
  $('results').innerHTML = '<p class="hint">Mencari…</p>';
  try {
    const { songs, visitorData } = await YT.searchSongs(q);
    if (visitorData && !YT.getSession()?.visitorData) saveSession({ ...(YT.getSession() || {}), visitorData });
    log(`Cari "${q}": ${songs.length} lagu.`);
    renderSongList($('results'), songs, (s, i) => player.playQueue(songs, i, `Pencarian: ${q}`));
  } catch (e) {
    $('results').innerHTML = `<p class="hint">Pencarian gagal: ${e.message}</p>`;
    log(`Search GAGAL: ${e.message} ${e.body || ''}`);
  }
}
$('searchForm').addEventListener('submit', e => { e.preventDefault(); doSearch($('q').value); });
document.querySelectorAll('.qchip').forEach(c => c.onclick = () => { $('q').value = c.dataset.q; doSearch(c.dataset.q); });
$('btnBackHome').onclick = () => { $('resultsWrap').hidden = true; $('homeSections').hidden = false; };
function renderRecent() {
  const list = getRecent();
  $('recentWrap').hidden = !list.length;
  renderSongList($('recentList'), list, (s, i) => player.playQueue(list, i, 'Terakhir diputar'));
}
renderRecent();

// ---------- library ----------
let libraryLoadedFor = null;
async function loadLibrary() {
  const s = YT.getSession();
  const box = $('libraryList');
  if (!s?.cookie) {
    $('libraryHint').textContent = 'Masuk dengan Google untuk melihat playlist dan lagu yang kamu sukai.';
    box.innerHTML = '';
    libraryLoadedFor = null;
    return;
  }
  if (libraryLoadedFor === s.cookie) return;
  libraryLoadedFor = s.cookie;
  $('libraryHint').textContent = 'Memuat library…';
  box.innerHTML = '';
  // Liked songs shortcut is always offered; opening it verifies the endpoint live.
  box.appendChild(playlistRow({ browseId: 'VLLM', title: 'Lagu yang Disukai', byline: 'Playlist otomatis dari akunmu', thumb: '' }));
  try {
    const { playlists } = await YT.libraryPlaylists();
    log(`Library landing: ${playlists.length} playlist ditemukan.`);
    for (const p of playlists) if (p.browseId !== 'VLLM') box.appendChild(playlistRow(p));
    $('libraryHint').textContent = playlists.length ? '' : 'Playlist dari landing tidak terbaca — Lagu yang Disukai tetap bisa dibuka.';
  } catch (e) {
    log(`Library landing GAGAL: ${e.message} ${e.body || ''}`);
    $('libraryHint').textContent = 'Gagal memuat daftar playlist — coba buka Lagu yang Disukai, atau periksa log.';
  }
}
function playlistRow(p) {
  const b = document.createElement('button');
  b.className = 'plrow';
  b.innerHTML = `${p.thumb ? `<img loading="lazy" src="${p.thumb}">` : '<img>'}<div><div class="t"></div><div class="a"></div></div>`;
  b.querySelector('.t').textContent = p.title;
  b.querySelector('.a').textContent = p.byline || 'Playlist';
  b.onclick = () => openPlaylist(p);
  return b;
}
let currentPlaylistSongs = [];
async function openPlaylist(p) {
  showView('playlist');
  $('plTitle').textContent = p.title;
  $('plSub').textContent = 'Memuat…';
  $('plThumb').src = p.thumb || '';
  $('plSongs').innerHTML = '';
  try {
    const { songs } = await YT.browseSongs(p.browseId);
    currentPlaylistSongs = songs;
    $('plSub').textContent = `${songs.length} lagu • ${p.byline || ''}`;
    log(`Playlist "${p.title}" (${p.browseId}): ${songs.length} lagu.`);
    renderSongList($('plSongs'), songs, (s, i) => player.playQueue(songs, i, p.title));
  } catch (e) {
    $('plSub').textContent = 'Gagal memuat playlist.';
    log(`Browse playlist GAGAL: ${e.message} ${e.body || ''}`);
  }
}
$('btnBackLibrary').onclick = () => showView('library');
$('btnPlayAll').onclick = () => { if (currentPlaylistSongs.length) player.playQueue(currentPlaylistSongs, 0, $('plTitle').textContent); };

// ---------- player UI ----------
$('miniMeta').onclick = () => { $('nowPlayingSheet').hidden = false; };
$('miniThumb').onclick = () => { $('nowPlayingSheet').hidden = false; };
$('btnCloseNp').onclick = () => { $('nowPlayingSheet').hidden = true; };
$('btnQueueToggle').onclick = () => { $('queueWrap').hidden = !$('queueWrap').hidden; if (!$('queueWrap').hidden) renderQueue(player.state()); };
$('btnMiniPlay').onclick = () => player.toggle();
$('btnPlay').onclick = () => player.toggle();
$('btnMiniNext').onclick = () => player.next();
$('btnNext').onclick = () => player.next();
$('btnMiniPrev').onclick = () => player.prev();
$('btnPrev').onclick = () => player.prev();
$('btnShuffle').onclick = () => player.toggleShuffle();
$('btnRepeat').onclick = () => player.cycleRepeat();
$('npSeek').addEventListener('input', e => player.seekToFraction(e.target.value / 1000));

// ---------- account / login ----------
$('btnAccount').onclick = () => { $('accountSheet').hidden = false; };
$('btnCloseAccount').onclick = () => { $('accountSheet').hidden = true; };

const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com';
let loginPoll = null;
let loginOpen = false;
let loginFinishing = false;

async function tryCompleteLogin(source) {
  if (!loginOpen) return false;
  try {
    const merged = {};
    for (const url of ['https://music.youtube.com', 'https://www.youtube.com', 'https://youtube.com']) {
      const c = await InAppBrowser.getCookies({ url });
      Object.assign(merged, c || {});
    }
    const cookieStr = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ');
    if (!YT.hasCompleteLoginCookies(cookieStr)) return false;
    log(`Cookie lengkap tertangkap (${source}): ${Object.keys(merged).length} cookie.`);
    await InAppBrowser.executeScript({ code: `(function(){try{var c=window.ytcfg;var y=window.yt&&window.yt.config_;var v=(c&&c.get&&c.get('VISITOR_DATA'))||(y&&y.VISITOR_DATA);var d=(c&&c.get&&c.get('DATASYNC_ID'))||(y&&y.DATASYNC_ID);if(!v||!d){var ss=document.querySelectorAll('script');for(var i=0;i<ss.length;i++){var x=ss[i].textContent||'';if(!v){var m=x.match(/["']VISITOR_DATA["']\\s*:\\s*["']([^"']+)["']/);if(m)v=m[1];}if(!d){var n=x.match(/["'](?:DATASYNC_ID|dataSyncId)["']\\s*:\\s*["']([^"']+)["']/);if(n)d=n[1];}}}window.mobileApp.postMessage({detail:{type:'ytcfg',visitorData:v||null,dataSyncId:d||null}});}catch(e){window.mobileApp.postMessage({detail:{type:'ytcfg',error:String(e)}});}})();` });
    window.__pendingCookie = cookieStr;
    return true;
  } catch (e) {
    if (loginOpen) log(`tryCompleteLogin error: ${e.message}`);
    return false;
  }
}

async function finishLogin(extra) {
  const cookie = window.__pendingCookie;
  if (!cookie || loginFinishing) return;
  loginFinishing = true;
  loginOpen = false;
  window.__pendingCookie = null;
  if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
  let visitorData = extra?.visitorData || YT.getSession()?.visitorData || null;
  let dataSyncId = extra?.dataSyncId || null;
  if (!visitorData || !dataSyncId) {
    try {
      YT.setSession({ ...(YT.getSession() || {}), cookie });
      const h = await YT.fetchYtcfgFromHtml();
      visitorData = visitorData || h.visitorData;
      dataSyncId = dataSyncId || h.dataSyncId;
      log(`ytcfg via HTML: visitorData=${visitorData ? 'ada' : '—'} dataSyncId=${dataSyncId ? 'ada' : '—'}`);
    } catch (e) { log(`Ambil ytcfg via HTML gagal: ${e.message}`); }
  }
  saveSession({ cookie, visitorData, dataSyncId });
  log(`Sesi tersimpan. visitorData=${visitorData ? 'ada' : '—'} dataSyncId=${dataSyncId ? 'ada' : '—'}`);
  try { await InAppBrowser.close(); } catch {}
  try {
    const info = await YT.accountMenu();
    if (info.name) {
      saveSession({ ...YT.getSession(), accountName: info.name, accountEmail: info.email, accountHandle: info.handle });
      log(`Verifikasi akun OK: ${info.name} ${info.email || ''} (varian ${info.variant})`);
    } else {
      log(`account_menu tanpa nama akun (varian ${info.variant}, logged_in=${info.loggedIn ?? '?'}).`);
    }
  } catch (e) {
    log(`Verifikasi account_menu GAGAL: ${e.message} ${e.body || ''}`);
  }
  loginFinishing = false;
  libraryLoadedFor = null;
}

if (isNative) {
  InAppBrowser.addListener('messageFromWebview', e => {
    const d = e?.detail || e;
    if (d?.type === 'ytcfg') finishLogin(d);
  });
  InAppBrowser.addListener('closeEvent', () => { loginOpen = false; if (loginPoll) { clearInterval(loginPoll); loginPoll = null; } });
  InAppBrowser.addListener('browserPageLoaded', () => { tryCompleteLogin('pageLoaded'); });
  InAppBrowser.addListener('urlChangeEvent', e => { if ((e?.url || '').includes('music.youtube.com')) tryCompleteLogin('urlChange'); });
}

$('btnLogin').onclick = async () => {
  if (!isNative) { log('Login WebView hanya tersedia di APK. Di browser gunakan tempel cookie manual.'); return; }
  $('accountSheet').hidden = true;
  log('Membuka WebView login Google… silakan login seperti biasa.');
  loginOpen = true;
  try {
    await InAppBrowser.openWebView({ url: LOGIN_URL });
    if (loginPoll) clearInterval(loginPoll);
    loginPoll = setInterval(() => tryCompleteLogin('poll'), 3000);
  } catch (e) { loginOpen = false; log(`openWebView GAGAL: ${e.message}`); }
};
$('btnLogout').onclick = async () => {
  loginOpen = false;
  saveSession(null);
  libraryLoadedFor = null;
  if (isNative) { try { await InAppBrowser.clearAllCookies(); } catch {} }
  $('accountSheet').hidden = true;
  log('Sesi dihapus.');
};
$('btnPasteCookie').onclick = async () => {
  const cookie = $('cookiePaste').value.trim().replace(/^cookie:\s*/i, '');
  if (!YT.hasCompleteLoginCookies(cookie)) { log('Cookie tempel tidak lengkap (perlu LOGIN_INFO + SAPISID).'); return; }
  window.__pendingCookie = cookie;
  loginFinishing = false;
  await finishLogin({});
};

log(`KharuiMusic D1 siap. Runtime=${isNative ? 'NATIVE' : 'WEB'} platform=${Capacitor.getPlatform()}`);
if (YT.getSession()?.accountName) log(`Sesi ditemukan: ${YT.getSession().accountName}`);
