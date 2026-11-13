// Web Push ilman ulkopuolisia kirjastoja: VAPID (RFC 8292) ja aes128gcm-salaus (RFC 8291 / RFC 8188).
// Toimii Cloudflare Workersissa ja Node 22:ssa (globalThis.crypto.subtle).
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  },
};
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

export async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Vain tunnettujen selainvalmistajien push-palvelut, jotta palvelin ei lähetä pyyntöjä mihin tahansa osoitteeseen.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com', 'push.apple.com'];
export function allowedEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
  } catch { return false; }
}

/** Salaa viestin selaimen julkisella avaimella (p256dh) ja auth-salaisuudella. */
export async function encryptPayload(payload, p256dh, auth, { salt = crypto.getRandomValues(new Uint8Array(16)) } = {}) {
  const uaPublic = b64u.decode(p256dh), authSecret = b64u.decode(auth);
  const local = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', local.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)), new Uint8Array([2]));
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const header = new Uint8Array(21); header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** VAPID-otsake: lyhytikäinen ES256-allekirjoitettu JWT push-palvelun osoitteelle. */
export async function vapidHeader(endpoint, publicKey, privateKey, subject, now = Math.floor(Date.now() / 1000)) {
  const pub = b64u.decode(publicKey);
  const key = await subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = obj => b64u.encode(enc.encode(JSON.stringify(obj)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: subject })}`;
  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u.encode(signature)}, k=${publicKey}`;
}

export const pushConfigured = env => Boolean(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY);

/** Lähettää yhden push-viestin. Palauttaa HTTP-tilan; 404/410 tarkoittaa vanhentunutta tilausta. */
export async function sendPush(env, subscription, payload, fetcher = fetch) {
  if (!allowedEndpoint(subscription.endpoint)) return 400;
  const body = await encryptPayload(payload, subscription.p256dh, subscription.auth);
  const response = await fetcher(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT || 'mailto:sijaispoyta@example.invalid'),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high',
    },
    body,
    signal: AbortSignal.timeout?.(8000),
  });
  return response.status;
}

export async function generateVapidKeys() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64u.encode(await subtle.exportKey('raw', pair.publicKey)), privateKey: jwk.d };
}
