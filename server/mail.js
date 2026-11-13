// Sähköpostit: ilmoitukset ja aamukooste. Lähetys Resendin REST-rajapinnalla (toimii Workersissa fetchillä).
// Ilman asetuksia (RESEND_API_KEY, MAIL_FROM) mitään ei lähetetä eikä mitään merkitä lähetetyksi.
import { buildDigest } from './digest.js';
import { today } from '../public/domain.js';

const SUBJECTS = {
  apply: 'Uusi ilmoittautuminen', withdraw: 'Ilmoittautuminen peruttu', confirm: 'Sijaisuus vahvistettu',
  cancel: 'Sijaisuus peruttu', addNeed: 'Uusi poissaolo', availability: 'Saatavuus ilmoitettu',
};
const FRESH_MS = 2 * 60 * 60 * 1000; // Vanhoja ilmoituksia ei lähetetä jälkikäteen, kun sähköposti kytketään päälle.

export const mailConfigured = env => Boolean(env?.RESEND_API_KEY && env?.MAIL_FROM);

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

/** Merkitsee käsittelemättömät ilmoitukset käsitellyiksi ja palauttaa lähetettävät viestit. */
export function claimNotificationEmails(state, origin, now = Date.now()) {
  const out = [];
  for (const n of state.notifications || []) {
    if (n.emailed !== undefined) continue;
    n.emailed = true;
    if (now - Date.parse(n.at) > FRESH_MS) continue;
    const link = `${origin}/?${n.date ? `date=${n.date}` : ''}${n.needId ? `&need=${encodeURIComponent(n.needId)}` : ''}`;
    for (const to of emailsFor(state, n.to, 'notify')) {
      out.push({ to, subject: `Sijaispöytä: ${SUBJECTS[n.type] || 'ilmoitus'}`, ...renderEmail({ heading: SUBJECTS[n.type] || 'Ilmoitus', text: n.text, link, footer: 'Sait tämän, koska olet ottanut sähköposti-ilmoitukset käyttöön Sijaispöydässä. Voit poistaa ne sovelluksen kellon kautta.' }) });
    }
  }
  return out;
}

/** Lähettää uudet ilmoitukset. Merkintä tehdään ensin tietokantaan, jotta sama viesti ei lähde kahdesti. */
export async function deliverPending(store, env, origin, fetcher = fetch) {
  if (!mailConfigured(env)) return { sent: 0, configured: false };
  const messages = await store.mutate(state => claimNotificationEmails(state, origin));
  let sent = 0;
  for (const m of messages || []) { try { await sendEmail(env, m, fetcher); sent++; } catch (e) { console.error(e.message); } }
  return { sent, configured: true };
}

/** Aamukooste. Palauttaa vain lukumääriä, ei henkilötietoja (tulos voi päätyä julkiseen lokiin). */
export async function runDigest(store, env, { origin, date = today(), dry = false, fetcher = fetch } = {}) {
  if (!dry && !mailConfigured(env)) return { sent: 0, configured: false };
  let messages = [];
  const build = state => {
    const digest = buildDigest(state, date), out = [];
    const link = `${origin}/?date=${date}`, footer = 'Sijaispöydän aamukooste arkiaamuisin. Voit poistaa sen sovelluksen kellon kautta.';
    if (digest.coordinator) for (const to of emailsFor(state, 'coordinator', 'digest')) out.push({ to, subject: digest.coordinator.subject, ...renderEmail({ heading: 'Aamukooste', text: digest.coordinator.text, link, footer }) });
    for (const [id, d] of Object.entries(digest.people)) for (const to of emailsFor(state, id, 'digest')) out.push({ to, subject: d.subject, ...renderEmail({ heading: 'Päiväsi tilanne', text: d.text, link, footer }) });
    return out;
  };
  if (dry) {
    messages = build((await store.read()).state);
    return { dry: true, date, wouldSend: messages.length };
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
  for (const m of messages) { try { await sendEmail(env, m, fetcher); sent++; } catch (e) { console.error(e.message); } }
  return { sent, date };
}
