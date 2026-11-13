import test from 'node:test';
import assert from 'node:assert/strict';
import { b64u, hkdf, encryptPayload, vapidHeader, generateVapidKeys, allowedEndpoint } from '../server/webpush.js';
const subtle = globalThis.crypto.subtle, enc = new TextEncoder();
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

// Selaimen puoli (RFC 8291): puretaan viesti, jotta salaus on varmasti oikein.
async function browserDecrypt(body, ua, uaPublic, auth) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  assert.equal(plain.at(-1), 2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

test('Push-viesti salautuu niin, että selain saa sen auki', async () => {
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  const payload = { title: 'Sijaispöytä', body: 'Sinut on vahvistettu sijaiseksi: 3. luokka · Pääainetunti' };
  const body = await encryptPayload(payload, b64u.encode(uaPublic), b64u.encode(auth));
  assert.deepEqual(JSON.parse(await browserDecrypt(body, ua, uaPublic, auth)), payload);
});
test('VAPID-allekirjoitus on voimassa ja kohdistuu push-palveluun', async () => {
  const keys = await generateVapidKeys();
  assert.equal(b64u.decode(keys.publicKey).length, 65);
  const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', keys.publicKey, keys.privateKey, 'mailto:test@koulu.test', 1000);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = jwt.split('.');
  const claims = JSON.parse(new TextDecoder().decode(b64u.decode(c)));
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: 1000 + 12 * 3600, sub: 'mailto:test@koulu.test' });
  const pub = await subtle.importKey('raw', b64u.decode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u.decode(sig), enc.encode(h + '.' + c)));
});
test('Vain tunnetut push-palvelut hyväksytään', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?token=x']) assert.ok(allowedEndpoint(ok), ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/', 'not a url']) assert.ok(!allowedEndpoint(bad), bad);
});
