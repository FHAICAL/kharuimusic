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

async function ytHeaders(client, { login = false } = {}) {
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
      const pageId = session.dataSyncId?.split('||')[0];
      if (pageId) h['X-Goog-PageId'] = pageId;
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

export async function searchSongs(query) {
  const client = CLIENTS.WEB_REMIX;
  const json = await ytPost('search', client, {
    context: { client: { ...client.ctx, visitorData: session?.visitorData } },
    query, params: 'EgWKAQIIAWoKEAoQBBAFEAkQBQ%3D%3D', // songs filter
  }, { login: true });
  const visitor = json?.responseContext?.visitorData;
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
        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        songs.push({ videoId: id, title: col(0), byline: col(1), thumb: thumbs[thumbs.length - 1]?.url || '' });
      }
    }
    for (const v of Object.values(node)) walk(v);
  })(json);
  return { songs, visitorData: visitor, raw: json };
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

export async function accountMenu() {
  const client = CLIENTS.WEB_REMIX;
  const json = await ytPost('account/account_menu', client, {
    context: { client: { ...client.ctx, visitorData: session?.visitorData, dataSyncId: undefined } },
  }, { login: true });
  let name = null, email = null, handle = null;
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const hdr = node.activeAccountHeaderRenderer;
    if (hdr) {
      name = hdr.accountName?.runs?.map(r => r.text).join('') || name;
      email = hdr.email?.simpleText || hdr.accountHandle?.runs?.map(r => r.text).join('') || email;
      handle = hdr.channelHandle?.simpleText || handle;
    }
    for (const v of Object.values(node)) walk(v);
  })(json);
  return { name, email, handle, raw: json };
}
