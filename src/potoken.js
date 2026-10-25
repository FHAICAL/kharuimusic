// PoToken minter — BgUtils (MIT, LuanRT) v3.2.0, same protocol ArchiveTune
// implements natively (Create -> BotGuard snapshot -> GenerateIT -> mint).
// Runs in the WebView's real browser environment; fetch is injected so the
// native transport (CapacitorHttp patch) is used inside the APK.
import { BG } from 'bgutils-js';

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

async function loadInterpreter(challenge) {
  const js = challenge.interpreterJavascript;
  const src = js?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  const url = js?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (src) {
    (0, eval)(src);
    return 'inline script';
  }
  if (url) {
    const code = await (await fetch(url)).text();
    (0, eval)(code);
    return 'script url';
  }
  throw new Error('Challenge has no interpreter script');
}

/**
 * Mint a PoToken bound to `identifier`:
 *  - session token: identifier = visitorData
 *  - content/GVS token: identifier = videoId
 * Returns the websafe token string.
 */
export async function mintPoToken(identifier, log = () => {}) {
  const bgConfig = {
    fetch: (input, init) => fetch(input, init),
    globalObj: window,
    identifier,
    requestKey: REQUEST_KEY,
  };
  log('PoToken: meminta challenge (Create)…');
  const challenge = await BG.Challenge.create(bgConfig);
  if (!challenge) throw new Error('Challenge.create returned null');
  log(`PoToken: challenge diterima (program ${challenge.program?.length || 0} chars, global=${challenge.globalName})`);
  const how = await loadInterpreter(challenge);
  log(`PoToken: interpreter BotGuard dimuat (${how})`);
  const { poToken } = await BG.PoToken.generate({
    program: challenge.program,
    globalName: challenge.globalName,
    bgConfig,
  });
  if (!poToken) throw new Error('PoToken.generate returned empty token');
  log(`PoToken: token jadi, panjang ${poToken.length}`);
  return poToken;
}
