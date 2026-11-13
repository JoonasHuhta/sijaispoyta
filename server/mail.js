// Ilmoitusten lähetys: sähköposti (Resendin REST-rajapinta) ja push-ilmoitus puhelimeen (Web Push).
// Ilman asetuksia (RESEND_API_KEY + MAIL_FROM tai VAPID-avaimet) mitään ei lähetetä eikä merkitä lähetetyksi.
import { buildDigest } from './digest.js';
import { pushConfigured, sendPush } from './webpush.js';
import { today } from '../domain.js';

const SUBJECTS = {
  apply: 'Uusi ilmoittautuminen', withdraw: 'Ilmoittautuminen peruttu', confirm: 'Sijaisuus vahvistettu',
  cancel: 'Sijaisuus peruttu', addNeed: 'Uusi poissaolo', availability: 'Saatavuus ilmoitettu',
};
const FRESH_MS = 2 * 60 * 60 * 1000; // Vanhoja ilmoituksia ei lähetetä jälkikäteen, kun sähköposti kytketään päälle.

export const mailConfigured = env => Boolean(env?.RESEND_API_KEY && env?.MAIL_FROM);
export { pushConfigured };

/** Push-tilaukset vastaanottaja-avaimelle. onlyMember rajaa yhteen tunnukseen (kokeiluilmoitus). */
export function subscriptionsFor(state, to, onlyMember = null) {
  const members = new Set((state.members || []).filter(m => (to === 'coordinator' ? m.role === 'coordinator' : m.personId === to)).map(m => m.id));
  return (state.pushSubs || []).filter(sub => members.has(sub.memberId) && (!onlyMember || sub.memberId === onlyMember));
}

/** Sähköpostiosoitteet vastaanottaja-avaimelle ('coordinator' tai henkilön id) ja tyypille ('notify' | 'digest'). */
export function emailsFor(state, to, kind) {
  const prefs = state.emailPrefs || {};
  return (state.members || [])
    .filter(m => m.email && prefs[m.id]?.[kind] && (to === 'coordinator' ? m.role === 'coordinator' : m.personId === to))
    .map(m => m.email);
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function renderEmail({ heading, text, link, footer }) {
  const plain = `${text}\n\nAvaa Sijaispöytä: ${link}\n\n${footer}`;
  const html = `<!doctype html><html lang="fi"><body style="margin:0;background:#f4f6fa;font-family:Segoe UI,Arial,sans-serif;color:#1c2541">
<div style="height:5px;background:linear-gradient(90deg,#2f9150 0 20%,#f2c200 20% 40%,#d81e2c 40% 60%,#2b4596 60% 80%,#1d7cc4 80%)"></div>
<div style="max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;color:#2b4596;margin:0 0 14px">${escapeHtml(heading)}</h1>
<div style="background:#fff;border:1px solid #e2e6ef;border-radius:14px;padding:18px 20px;font-size:15px;line-height:1.6;white-space:pre-line">${escapeHtml(text)}</div>
<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#2b4596;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:600;display:inline-block">Avaa Sijaispöytä</a></p>
<p style="font-size:12px;color:#5d6883;line-height:1.5">${escapeHtml(footer)}</p></div></body></html>`;
  return { text: plain, html };
}

export async function sendEmail(env, { to, subject, text, html }, fetcher = fetch) {
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout?.(8000),
  });
  if (!response.ok) throw new Error(`Sähköpostin lähetys epäonnistui (${response.status}).`);
}

/** Merkitsee käsittelemättömät ilmoitukset käsitellyiksi ja palauttaa lähetettävät viestit ({ emails, pushes }). */
export function claimDeliveries(state, origin, env = {}, now = Date.now()) {
  const emails = [], pushes = [];
  const mail = mailConfigured(env), push = pushConfigured(env);
  for (const n of state.notifications || []) {
    if (n.delivered !== undefined) continue;
    n.delivered = true;
    if (now - Date.parse(n.at) > FRESH_MS) continue;
    const link = `${origin}/?${n.date ? `date=${n.date}` : ''}${n.needId ? `&need=${encodeURIComponent(n.needId)}` : ''}`;
    if (mail && n.type !== 'test') for (const to of emailsFor(state, n.to, 'notify')) {
      emails.push({ to, subject: `Sijaispöytä: ${SUBJECTS[n.type] || 'ilmoitus'}`, ...renderEmail({ heading: SUBJECTS[n.type] || 'Ilmoitus', text: n.text, link, footer: 'Sait tämän, koska olet ottanut sähköposti-ilmoitukset käyttöön Sijaispöydässä. Voit poistaa ne sovelluksen kellon kautta.' }) });
    }
    if (push) for (const sub of subscriptionsFor(state, n.to, n.onlyMember)) {
      pushes.push({ sub, payload: { title: SUBJECTS[n.type] || 'Sijaispöytä', body: n.text, url: link, tag: n.id } });
    }
  }
  return { emails, pushes };
}

/** Lähettää push-viestit ja poistaa vanhentuneet tilaukset (404/410). */
async function sendPushes(store, env, pushes, fetcher) {
  let sent = 0; const dead = new Set();
  for (const { sub, payload } of pushes) {
    try { const status = await sendPush(env, sub, payload, fetcher); if (status >= 200 && status < 300) sent++; else if (status === 404 || status === 410) dead.add(sub.endpoint); }
    catch (e) { console.error('Push:', e.message); }
  }
  if (dead.size) await store.mutate(state => { state.pushSubs = (state.pushSubs || []).filter(x => !dead.has(x.endpoint)); });
  return sent;
}

/** Lähettää uudet ilmoitukset. Merkintä tehdään ensin tietokantaan, jotta sama viesti ei lähde kahdesti. */
export async function deliverPending(store, env, origin, fetcher = fetch) {
  if (!mailConfigured(env) && !pushConfigured(env)) return { sent: 0, configured: false };
  const { emails, pushes } = await store.mutate(state => claimDeliveries(state, origin, env));
  let sent = 0;
  for (const m of emails) { try { await sendEmail(env, m, fetcher); sent++; } catch (e) { console.error(e.message); } }
  const pushed = await sendPushes(store, env, pushes, fetcher);
  return { sent, pushed, configured: true };
}

/** Aamukooste. Palauttaa vain lukumääriä, ei henkilötietoja (tulos voi päätyä julkiseen lokiin). */
export async function runDigest(store, env, { origin, date = today(), dry = false, fetcher = fetch } = {}) {
  if (!dry && !mailConfigured(env) && !pushConfigured(env)) return { sent: 0, configured: false };
  let messages = [], pushes = [];
  const build = state => {
    const digest = buildDigest(state, date), out = [];
    const link = `${origin}/?date=${date}`, footer = 'Sijaispöydän aamukooste arkiaamuisin. Voit poistaa sen sovelluksen kellon kautta.';
    const mail = mailConfigured(env) || dry, push = pushConfigured(env) || dry;
    pushes = [];
    const short = text => text.split('\n').filter(Boolean).slice(1, 4).join('\n');
    if (digest.coordinator) {
      if (mail) for (const to of emailsFor(state, 'coordinator', 'digest')) out.push({ to, subject: digest.coordinator.subject, ...renderEmail({ heading: 'Aamukooste', text: digest.coordinator.text, link, footer }) });
      if (push) for (const sub of subscriptionsFor(state, 'coordinator')) pushes.push({ sub, payload: { title: digest.coordinator.subject, body: short(digest.coordinator.text), url: link, tag: 'digest-' + date } });
    }
    for (const [id, d] of Object.entries(digest.people)) {
      if (mail) for (const to of emailsFor(state, id, 'digest')) out.push({ to, subject: d.subject, ...renderEmail({ heading: 'Päiväsi tilanne', text: d.text, link, footer }) });
      if (push) for (const sub of subscriptionsFor(state, id)) pushes.push({ sub, payload: { title: 'Sijaispöytä: päiväsi tilanne', body: short(d.text), url: link, tag: 'digest-' + date } });
    }
    return out;
  };
  if (dry) {
    messages = build((await store.read()).state);
    return { dry: true, date, wouldSend: messages.length, wouldPush: pushes.length };
  }
  let already = false;
  messages = await store.mutate(state => {
    state.digestSent ||= {};
    if (state.digestSent[date]) { already = true; return []; }
    state.digestSent[date] = new Date().toISOString();
    for (const key of Object.keys(state.digestSent).sort().slice(0, -14)) delete state.digestSent[key];
    return build(state);
  });
  if (already) return { sent: 0, alreadySent: true, date };
  let sent = 0;
  if (mailConfigured(env)) for (const m of messages) { try { await sendEmail(env, m, fetcher); sent++; } catch (e) { console.error(e.message); } }
  const pushed = await sendPushes(store, env, pushes, fetcher);
  return { sent, pushed, date };
}
