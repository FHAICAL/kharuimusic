// InnerTube client (JS) — port of behaviour mapped from ArchiveTune :core
// (WEB_REMIX main client + fallback chain), written from the protocol spec
// in the REA analysis, not copied Kotlin code.

export const CLIENTS = {
  WEB_REMIX: {
    name: 'WEB_REMIX', version: '1.20260707.12.00', id: '67',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
    ctx: { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00', hl: 'en', gl: 'US' },
    origin: 'https://music.youtube.com', login: true, webPo: true,
  },
  WEB: {
    name: 'WEB', version: '2.20260708.00.00', id: '1',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    ctx: { clientName: 'WEB', clientVersion: '2.20260708.00.00', hl: 'en', gl: 'US' },
    origin: 'https://www.youtube.com', login: true, webPo: true,
  },
  VISIONOS: {
    name: 'VISIONOS', version: '0.1', id: '101',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    ctx: { clientName: 'VISIONOS', clientVersion: '0.1', osName: 'visionOS', osVersion: '1.3.21O771', deviceMake: 'Apple', deviceModel: 'RealityDevice14,1', hl: 'en', gl: 'US' },
    origin: 'https://www.youtube.com', login: false, webPo: false,
  },
  ANDROID_VR: {
    name: 'ANDROID_VR', version: '1.65.10', id: '28',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    ctx: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L', androidSdkVersion: 32, hl: 'en', gl: 'US' },
    origin: 'https://www.youtube.com', login: false, webPo: false,
  },
  MWEB: {
    name: 'MWEB', version: '2.20260708.05.00', id: '2',
    ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    ctx: { clientName: 'MWEB', clientVersion: '2.20260708.05.00', hl: 'en', gl: 'US' },
    origin: 'https://m.youtube.com', login: true, webPo: true,
  },
};

// Fallback order copied from ArchiveTune YTPlayerUtils (main = WEB_REMIX).
export const FALLBACK_ORDER = ['VISIONOS', 'ANDROID_VR', 'WEB_REMIX', 'WEB', 'MWEB'];

const API_BASE = 'https://music.youtube.com/youtubei/v1/';

let session = null; // { cookie, visitorData, dataSyncId }
export function setSession(s) { session = s; }
export function getSession() { return session; }

export async function sha1Hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function loginCookieValue(cookie) {
  if (!cookie) return null;
  const map = parseCookies(cookie);
  for (const n of ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID']) if (map[n]) return map[n];
  return null;
}
export function parseCookies(cookie) {
  const out = {};
  for (const part of String(cookie).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
export function hasCompleteLoginCookies(cookie) {
  const map = parseCookies(cookie || '');
  return !!map['LOGIN_INFO'] && !!loginCookieValue(cookie);
}

async function ytHeaders(client, { login = false, pageId = true } = {}) {
  const h = {
    'Content-Type': 'application/json',
    'X-YouTube-Client-Name': client.id,
    'X-YouTube-Client-Version': client.version,
    'X-Origin': client.origin,
    'Referer': client.origin + '/',
    'User-Agent': client.ua,
    'X-Goog-Api-Format-Version': '1',
  };
  if (session?.visitorData) h['X-Goog-Visitor-Id'] = session.visitorData;
  if (login && client.login && session?.cookie) {
    const v = loginCookieValue(session.cookie);
    if (v) {
      const ts = Math.floor(Date.now() / 1000);
      h['Cookie'] = session.cookie;
      h['Authorization'] = `SAPISIDHASH ${ts}_${await sha1Hex(`${ts} ${v} ${client.origin}`)}`;
      h['X-Goog-AuthUser'] = '0';
      // NOTE: X-Goog-PageId is deliberately NOT sent. Proven on device
      // (2026-10-26): with the header derived from the scraped dataSyncId,
      // account_menu answers logged_in=0 / HTTP 500; without it the same
      // session verifies fine. The `pageId` option is kept for signature
      // compatibility but ignored.
    }
  }
  return h;
}

export async function ytPost(endpoint, client, body, opts = {}) {
  const url = endpoint.startsWith('http') ? endpoint : API_BASE + endpoint;
  const headers = await ytHeaders(client, opts);
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'prettyPrint=false', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${endpoint}`);
    err.status = res.status; err.body = text.slice(0, 400); err.json = json;
    throw err;
  }
  return json;
}

// ---------- generic response extractors ----------
export function extractSongs(json) {
  const songs = [];
  const seen = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const r = node.musicResponsiveListItemRenderer;
    if (r) {
      const id = r.playlistItemData?.videoId || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const col = i => r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(x => x.text).join('') || '';
        const fixed = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.map(x => x.text).join('') || '';
        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        songs.push({ videoId: id, title: col(0), byline: col(1), duration: fixed || col(2) || '', thumb: thumbs[thumbs.length - 1]?.url || '' });
      }
    }
    const p = node.playlistPanelVideoRenderer;
    if (p?.videoId && !seen.has(p.videoId)) {
      seen.add(p.videoId);
      const thumbs = p.thumbnail?.thumbnails || [];
      songs.push({
        videoId: p.videoId,
        title: p.title?.runs?.map(x => x.text).join('') || '',
        byline: p.shortBylineText?.runs?.map(x => x.text).join('') || '',
        duration: p.lengthText?.runs?.map(x => x.text).join('') || '',
        thumb: thumbs[thumbs.length - 1]?.url || '',
      });
    }
    for (const v of Object.values(node)) walk(v);
  })(json);
  return songs;
}

export function extractPlaylists(json) {
  const out = [];
  const seen = new Set();
  const readItem = (title, browseId, thumbs, sub) => {
    if (!browseId || seen.has(browseId) || !title) return;
    if (!/^(VL|PL|OLAK|UU)/.test(browseId) && browseId !== 'VLLM') return;
    seen.add(browseId);
    out.push({ browseId, title, byline: sub || '', thumb: thumbs?.[thumbs.length - 1]?.url || '' });
  };
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const t = node.musicTwoRowItemRenderer;
    if (t) {
      readItem(
        t.title?.runs?.map(x => x.text).join(''),
        t.navigationEndpoint?.browseEndpoint?.browseId,
        t.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails,
        t.subtitle?.runs?.map(x => x.text).join(''),
      );
    }
    const g = node.gridPlaylistRenderer;
    if (g) {
      readItem(
        g.title?.runs?.map(x => x.text).join(''),
        g.navigationEndpoint?.browseEndpoint?.browseId || (g.playlistId ? 'VL' + g.playlistId : null),
        g.thumbnail?.thumbnails,
        g.videoCountShortText?.runs?.map(x => x.text).join('') || '',
      );
    }
    const r = node.musicResponsiveListItemRenderer;
    if (r) {
      const bid = r.navigationEndpoint?.browseEndpoint?.browseId
        || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
      const col = i => r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(x => x.text).join('') || '';
      const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      readItem(col(0), bid, thumbs, col(1));
    }
    for (const v of Object.values(node)) walk(v);
  })(json);
  return out;
}

export async function searchSongs(query) {
  const client = CLIENTS.WEB_REMIX;
  const json = await ytPost('search', client, {
    context: { client: { ...client.ctx, visitorData: session?.visitorData } },
    query, params: 'EgWKAQIIAWoKEAoQBBAFEAkQBQ%3D%3D', // songs filter
  }, { login: true });
  return { songs: extractSongs(json), visitorData: json?.responseContext?.visitorData, raw: json };
}

export async function browse(browseId) {
  const client = CLIENTS.WEB_REMIX;
  return ytPost('browse', client, {
    context: { client: { ...client.ctx, visitorData: session?.visitorData } },
    browseId,
  }, { login: true });
}

export async function browseSongs(browseId) {
  const json = await browse(browseId);
  return { songs: extractSongs(json), raw: json };
}

// Library landing: returns whatever playlists YouTube exposes for the
// account (defensive extraction — the structure varies by account).
export async function libraryPlaylists() {
  const json = await browse('FEmusic_library_landing');
  return { playlists: extractPlaylists(json), raw: json };
}

// "Up next" / radio suggestions for a seed song. A bare `next` call often
// returns only the seed item plus an automix playlist id (RDAMVM…); the
// actual suggestions live in that mix, which is browsable as VL<mixId>.
export async function watchNext(videoId) {
  const client = CLIENTS.WEB_REMIX;
  const json = await ytPost('next', client, {
    context: { client: { ...client.ctx, visitorData: session?.visitorData } },
    videoId, enablePersistentPlaylistPanel: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL', isAudioOnly: true,
  }, { login: true });
  let songs = extractSongs(json).filter(s => s.videoId !== videoId);
  if (songs.length < 2) {
    // The mix itself must be loaded through `next` with the automix
    // playlistId — browsing VL<mixId> returns an empty page.
    const mixId = JSON.stringify(json).match(/RDAMVM[a-zA-Z0-9_-]+/)?.[0];
    if (mixId) {
      const mixJson = await ytPost('next', client, {
        context: { client: { ...client.ctx, visitorData: session?.visitorData } },
        videoId, playlistId: mixId, enablePersistentPlaylistPanel: true, isAudioOnly: true,
      }, { login: true });
      const mixSongs = extractSongs(mixJson).filter(s => s.videoId !== videoId);
      if (mixSongs.length > songs.length) songs = mixSongs;
    }
  }
  return { songs, raw: json };
}

export async function player(videoId, client, { poToken = null, login = false } = {}) {
  const body = {
    context: { client: { ...client.ctx, visitorData: session?.visitorData } },
    videoId, racyCheckOk: true, contentCheckOk: true,
  };
  if (poToken) body.serviceIntegrityDimensions = { poToken };
  const json = await ytPost(client.origin + '/youtubei/v1/player', client, body, { login });
  return json;
}

export function pickAudioFormat(playerJson) {
  const fmts = playerJson?.streamingData?.adaptiveFormats || [];
  const aud = fmts.filter(f => (f.mimeType || '').startsWith('audio'));
  aud.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const direct = aud.find(f => f.url);
  return { all: aud, best: direct || aud[0] || null, ciphered: aud.length > 0 && !direct };
}

// Fetch the music.youtube.com homepage HTML (with the session cookie when
// logged in) and pull ytcfg values out of it. The initial page HTML embeds
// ytcfg.set({...}) with VISITOR_DATA and, for a logged-in session,
// DATASYNC_ID — this does not depend on WebView page-load timing, unlike
// reading window.ytcfg from inside the login WebView.
export async function fetchYtcfgFromHtml() {
  const headers = { 'User-Agent': CLIENTS.WEB_REMIX.ua, 'Accept-Language': 'en' };
  if (session?.cookie) headers['Cookie'] = session.cookie;
  const res = await fetch('https://music.youtube.com/', { headers });
  const html = await res.text();
  const grab = keys => {
    for (const k of keys) {
      const m = html.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]+)"'));
      if (m) return m[1];
    }
    return null;
  };
  return {
    visitorData: grab(['VISITOR_DATA', 'visitorData']),
    dataSyncId: grab(['DATASYNC_ID', 'dataSyncId']),
  };
}

export async function accountMenu() {
  const client = CLIENTS.WEB_REMIX;
  const parse = json => {
    let name = null, email = null, handle = null, loggedIn = null;
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      const hdr = node.activeAccountHeaderRenderer;
      if (hdr) {
        name = hdr.accountName?.runs?.map(r => r.text).join('') || name;
        email = hdr.email?.simpleText || hdr.accountHandle?.runs?.map(r => r.text).join('') || email;
        handle = hdr.channelHandle?.simpleText || handle;
      }
      if (Array.isArray(node.params)) {
        for (const p of node.params) if (p.key === 'logged_in' || p.key === 'yt_li') loggedIn = p.value;
      }
      for (const v of Object.values(node)) walk(v);
    })(json);
    return { name, email, handle, loggedIn, raw: json };
  };
  const body = { context: { client: { ...client.ctx, visitorData: session?.visitorData } } };
  const first = parse(await ytPost('account/account_menu', client, body, { login: true }));
  if (first.name) return { ...first, variant: 'standar' };
  // One plain retry: account_menu occasionally answers a transient backend
  // error (HTTP 500) even for a valid session.
  const second = parse(await ytPost('account/account_menu', client, body, { login: true }));
  return { ...second, variant: 'ulang', firstLoggedIn: first.loggedIn };
}
