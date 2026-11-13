import { buildDigest } from './digest.js';
export { buildDigest };
import { mailConfigured, pushConfigured, deliverPending, runDigest } from './mail.js';
import { allowedEndpoint } from './webpush.js';
import { seed, uid, addPerson, addAvailability, removeAvailability, addNeed, apply, confirmAssignment, cancelAssignment, eligibility, today, report } from '../public/domain.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, text) => { throw new HttpError(status, text); };
const emailKey = value => String(value || '').trim().toLowerCase();

export function actorFor(state, identity, adminEmail) {
  if (!identity?.id || !identity.email) fail(401, 'Kirjaudu ensin ChatGPT:llä.');
  const member = (state.members || []).find(m => m.userId === identity.id || (!m.userId && m.email === emailKey(identity.email)));
  if (member) return { ...member, userId: identity.id };
  // Only the configured owner may bootstrap the first coordinator.
  if (!(state.members || []).some(m => m.role === 'coordinator') && adminEmail && emailKey(identity.email) === emailKey(adminEmail)) {
    return { id: 'owner', userId: identity.id, email: emailKey(identity.email), role: 'coordinator', personId: null };
  }
  fail(403, 'Tunnustasi ei ole liitetty sijaispooliin. Pyydä sijaisvastaavaa lisäämään sähköpostiosoitteesi.');
}

export function project(state, actor) {
  if (actor.role === 'coordinator') return structuredClone(state);
  const ownId = actor.personId;
  return {
    version: state.version,
    people: state.people.filter(p => p.id === ownId),
    availability: state.availability.filter(a => a.personId === ownId),
    needs: state.needs.filter(n => !n.assignedId || n.assignedId === ownId).map(n => ({
      ...n, teacherId: n.teacherId === ownId ? ownId : '',
      notes: n.assignedId === ownId ? n.notes : '',
      applicants: n.applicants.filter(id => id === ownId),
      _reason: eligibility(state, n, ownId),
    })),
    events: state.events.filter(e => e.personId === ownId).map(({ actorId, ...event }) => event),
    notifications: (state.notifications || []).filter(n => n.to === ownId),
    emailPrefs: state.emailPrefs?.[actor.id] ? { [actor.id]: state.emailPrefs[actor.id] } : {},
  };
}

// Ilmoitukset: kuka saa tiedon mistäkin muutoksesta. Vastaanottaja on 'coordinator' (kaikki
// sijaisvastaavat) tai henkilön id. Sama lista on ulkoisten kanavien (sähköposti ym.) lähtölaatikko.
export const recipientKey = actor => actor.role === 'coordinator' ? 'coordinator' : actor.personId;
const when = n => { const [, m, d] = n.date.split('-'); return `${Number(d)}.${Number(m)}. klo ${n.start}–${n.end}`; };
const what = n => `${n.group} · ${n.subject}, ${when(n)}`;
export function notify(state, action, { actor, personId, prior, created, data }) {
  const name = id => state.people.find(p => p.id === id)?.name || 'Tuntematon';
  const current = data.id ? state.needs.find(n => n.id === data.id) : null;
  const items = [];
  const add = (to, need, text, type = action) => { if (to && to !== recipientKey(actor)) items.push({ to, type, needId: need?.id || null, date: need?.date || data.date || null, text }); };
  const byOther = actor.role !== 'coordinator';
  switch (action) {
    case 'apply': add('coordinator', current, `${name(personId)} ilmoittautui sijaiseksi: ${what(current)}.`); break;
    case 'withdraw': if (prior?.applicants.includes(personId)) add('coordinator', current, `${name(personId)} perui ilmoittautumisensa: ${what(current)}.`); break;
    case 'confirm':
      add(current.assignedId, current, `Sinut on vahvistettu sijaiseksi: ${what(current)}. Yhteyshenkilö: ${current.owner || 'sijaisvastaava'}.`);
      add(current.teacherId, current, `Sijaisesi on vahvistettu: ${name(current.assignedId)} hoitaa ${what(current)}.`);
      break;
    case 'cancel':
      add(prior.assignedId, current, `Sijaisuutesi on peruttu: ${what(current)}. Ota tarvittaessa yhteys sijaisvastaavaan.`);
      add(prior.teacherId, current, `Sijaisuus avautui uudelleen: ${what(current)}. ${name(prior.assignedId)} ei enää hoida tehtävää.`);
      break;
    case 'addNeed': if (byOther) add('coordinator', created, `${name(created.teacherId)} merkitsi poissaolon: ${what(created)}. Sijainen tarvitaan.`); break;
    case 'availability': if (byOther) add('coordinator', null, `${name(personId)} ilmoitti saatavuuden ${Number(data.date.slice(8))}.${Number(data.date.slice(5, 7))}. klo ${data.start}–${data.end}.`); break;
  }
  const at = new Date().toISOString();
  for (const item of items) state.notifications.push({ id: uid(), at, read: false, ...item });
  state.notifications = state.notifications.slice(-300);
}

export function execute(state, actor, action, data = {}) {
  const coordinator = actor.role === 'coordinator';
  const admin = () => { if (!coordinator) fail(403, 'Tämä toiminto kuuluu sijaisvastaavalle.'); };
  const personId = coordinator ? data.personId : actor.personId;
  const need = () => state.needs.find(n => n.id === data.id) || fail(404, 'Sijaisuutta ei löydy.');
  state.notifications ||= [];
  const prior = data.id ? structuredClone(state.needs.find(n => n.id === data.id) || null) : null;
  let created = null;
  switch (action) {
    case 'addPerson': admin(); addPerson(state, data); break;
    case 'availability': addAvailability(state, { ...data, personId }); break;
    case 'removeAvailability': {
      const entry = state.availability.find(a => a.id === data.id);
      if (!entry) fail(404, 'Saatavuutta ei löydy.');
      if (!coordinator && entry.personId !== actor.personId) fail(403, 'Voit muuttaa vain omaa saatavuuttasi.');
      removeAvailability(state, data.id); break;
    }
    case 'addNeed': {
      if (!coordinator && state.people.find(p => p.id === actor.personId)?.kind !== 'staff') fail(403, 'Vain oma henkilöstö voi merkitä poissaolon.');
      created = addNeed(state, { ...data, teacherId: coordinator ? data.teacherId : actor.personId }); break;
    }
    case 'apply': apply(state, data.id, personId); break;
    case 'withdraw': {
      const n = need();
      if (n.assignedId) fail(409, 'Sijaisuus on jo vahvistettu. Ota yhteys sijaisvastaavaan.');
      n.applicants = n.applicants.filter(id => id !== personId); break;
    }
    case 'confirm': admin(); confirmAssignment(state, data.id, data.personId); break;
    case 'cancel': admin(); cancelAssignment(state, data.id); break;
    case 'member': {
      admin();
      const email = emailKey(data.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, 'Anna kelvollinen sähköpostiosoite.');
      if (!state.people.some(p => p.id === data.personId)) fail(400, 'Valitse ensin henkilö.');
      if (state.members.some(m => m.email === email || m.personId === data.personId)) fail(409, 'Tunnus tai henkilö on jo liitetty.');
      state.members.push({ id: uid(), email, userId: null, role: 'substitute', personId: data.personId }); break;
    }
    case 'revokeMember': {
      admin();
      const member = state.members.find(m => m.id === data.id);
      if (!member || member.role === 'coordinator') fail(400, 'Sijaisvastaavan tunnusta ei poisteta tästä.');
      state.members = state.members.filter(m => m.id !== data.id); break;
    }
    case 'resetDemo': {
      admin(); const members = state.members;
      // Do not leave accounts pointing at people removed by the reset.
      if (members.some(m => m.role !== 'coordinator')) fail(409, 'Poista ensin kokeilutunnusten liitokset ennen esimerkkien palautusta.');
      Object.assign(state, seed(), { members, notifications: [] }); break;
    }
    case 'emailPrefs': {
      if (!actor.email) fail(400, 'Tunnukseen ei ole liitetty sähköpostiosoitetta.');
      state.emailPrefs ||= {};
      state.emailPrefs[actor.id] = { notify: data.notify === true, digest: data.digest === true };
      return;
    }
    case 'pushSubscribe': {
      const sub = data.subscription || {};
      const p256dh = sub.keys?.p256dh, auth = sub.keys?.auth;
      if (!allowedEndpoint(sub.endpoint) || sub.endpoint.length > 1000 || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh || '') || !/^[A-Za-z0-9_-]{16,32}$/.test(auth || '')) fail(400, 'Laitteen ilmoitustilaus ei kelpaa.');
      state.pushSubs = (state.pushSubs || []).filter(x => x.endpoint !== sub.endpoint);
      const mine = state.pushSubs.filter(x => x.memberId === actor.id);
      if (mine.length >= 5) state.pushSubs = state.pushSubs.filter(x => x !== mine[0]);
      state.pushSubs.push({ id: uid(), memberId: actor.id, endpoint: sub.endpoint, p256dh, auth, label: String(data.label || 'Laite').slice(0, 60), at: new Date().toISOString() });
      return;
    }
    case 'pushUnsubscribe': {
      state.pushSubs = (state.pushSubs || []).filter(x => !(x.memberId === actor.id && (x.endpoint === data.endpoint || x.id === data.id)));
      return;
    }
    case 'pushTest': {
      if (!(state.pushSubs || []).some(x => x.memberId === actor.id)) fail(400, 'Ota ensin puhelinilmoitukset käyttöön tällä laitteella.');
      state.notifications.push({ id: uid(), at: new Date().toISOString(), read: false, to: recipientKey(actor), onlyMember: actor.id, type: 'test', needId: null, date: null, text: 'Kokeiluilmoitus: puhelinilmoitukset toimivat tällä laitteella.' });
      state.notifications = state.notifications.slice(-300);
      return;
    }
    case 'markRead': {
      const key = recipientKey(actor);
      const ids = data.ids === 'all' ? null : data.ids;
      if (ids !== null && (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== 'string'))) fail(400, 'Tarkista ilmoitukset.');
      state.notifications.forEach(n => { if (n.to === key && (!ids || ids.includes(n.id))) n.read = true; });
      return; // Lukukuittaus ei ole muutoshistorian tapahtuma.
    }
    default: fail(400, 'Tuntematon toiminto.');
  }
  notify(state, action, { actor, personId, prior, created, data });
  state.events.push({ at: new Date().toISOString(), type: action, actorId: actor.userId, personId: personId || null, needId: data.id || null });
  state.events = state.events.slice(-500);
}

export class BoardStore {
  constructor(db) { this.db = db.withSession ? db.withSession('first-primary') : db; }
  async read() {
    const initial = { ...seed(), members: [], requests: [] };
    await this.db.prepare('INSERT OR IGNORE INTO board (id, revision, body) VALUES (1, 0, ?)').bind(JSON.stringify(initial)).run();
    const row = await this.db.prepare('SELECT revision, body FROM board WHERE id = 1').first();
    return { revision: row.revision, state: JSON.parse(row.body) };
  }
  /** Ajaa muutoksen vertaa-ja-vaihda -silmukassa ja palauttaa funktion tuloksen. */
  async mutate(change) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { revision, state } = await this.read();
      const result = change(state);
      const saved = await this.db.prepare('UPDATE board SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(JSON.stringify(state), revision).run();
      if (saved.meta.changes === 1) return result;
    }
    fail(409, 'Tilanne muuttui samaan aikaan. Yritä uudelleen.');
  }
  async update(identity, adminEmail, command) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { revision, state } = await this.read();
      const actor = actorFor(state, identity, adminEmail);
      const duplicate = state.requests.find(r => r.id === command.requestId);
      if (duplicate) {
        if (duplicate.actorId !== identity.id) fail(409, 'Pyyntötunnus on jo käytössä.');
        return { revision, state, actor };
      }
      const member = state.members.find(m => m.id === actor.id);
      if (member) member.userId = identity.id;
      else state.members.push(actor);
      execute(state, actor, command.action, command.data);
      state.requests.push({ id: command.requestId, actorId: identity.id });
      state.requests = state.requests.slice(-200);
      const result = await this.db.prepare('UPDATE board SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(JSON.stringify(state), revision).run();
      if (result.meta.changes === 1) return { state, revision: revision + 1, actor };
      // Another writer won. Read again and recheck permissions and eligibility.
    }
    fail(409, 'Tilanne muuttui samaan aikaan. Päivitä näkymä ja yritä uudelleen.');
  }
}

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const sameToken = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
/** Arkipäivä ja kello Helsingissä. */
export function helsinkiClock(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const day = new Date(today() + 'T12:00:00Z').getUTCDay();
  return { hour, weekday: day !== 0 && day !== 6 };
}
/** Varajärjestely: jos ajastus ei ole tavoittanut sovellusta, aamukooste lähtee ensimmäisestä käytöstä klo 7–10. */
async function digestIfDue(store, env, state, origin) {
  const { hour, weekday } = helsinkiClock();
  if (!weekday || hour < 7 || hour >= 10 || state.digestSent?.[today()]) return;
  if (!mailConfigured(env) && !pushConfigured(env)) return;
  try { await runDigest(store, env, { origin }); } catch (error) { console.error('Aamukooste:', error.message); }
}

async function handleCron(request, env) {
  // Ajastettu aamukooste (GitHub Actions tai muu ajastin). Ei ChatGPT-kirjautumista, vaan oma salainen token.
  if (request.method !== 'POST') fail(405, 'Käytä POST-pyyntöä.');
  if (!env.CRON_TOKEN || env.CRON_TOKEN.length < 24) fail(503, 'Ajastusta ei ole kytketty (CRON_TOKEN puuttuu).');
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameToken(token, env.CRON_TOKEN)) fail(401, 'Virheellinen tunniste.');
  if (!env.DB) fail(503, 'Yhteistä tietokantaa ei ole vielä kytketty.');
  const url = new URL(request.url);
  const minHour = Number(url.searchParams.get('minHour') || 0);
  const { hour, weekday } = helsinkiClock();
  if (!weekday) return json({ skipped: 'viikonloppu' });
  if (hour < minHour) return json({ skipped: 'liian aikaista', hour });
  const origin = env.SITE_URL || url.origin;
  return json(await runDigest(new BoardStore(env.DB), env, { origin, dry: url.searchParams.get('dry') === '1' }));
}

export async function handleApi(request, env) {
  try {
    if (new URL(request.url).pathname === '/api/cron/digest') return await handleCron(request, env);
    const identity = { id: request.headers.get('oai-authenticated-user-id'), email: request.headers.get('oai-authenticated-user-email') };
    if (!identity.id || !identity.email) fail(401, 'Kirjaudu ensin ChatGPT:llä.');
    if (!env.DB) fail(503, 'Yhteistä tietokantaa ei ole vielä kytketty.');
    const url = new URL(request.url);
    const store = new BoardStore(env.DB);
    let result;
    if (request.method === 'GET' && ['/api/state', '/api/report', '/api/digest'].includes(url.pathname)) {
      result = await store.read();
      result.actor = actorFor(result.state, identity, env.ADMIN_EMAIL);
      if (url.pathname === '/api/state') await digestIfDue(store, env, result.state, env.SITE_URL || url.origin);
      if (url.pathname === '/api/digest') {
        const date = url.searchParams.get('date') || today();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Tarkista päivä.');
        const digest = buildDigest(result.state, date);
        const own = result.actor.role === 'coordinator' ? digest.coordinator : digest.people[result.actor.personId];
        return json({ date, digest: own || null, mail: mailConfigured(env) });
      }
      if (url.pathname === '/api/report') {
        if (result.actor.role !== 'coordinator') fail(403, 'Raportti kuuluu sijaisvastaavalle.');
        const date = url.searchParams.get('date') || today();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Tarkista päivä.');
        return json({ date, revision: result.revision, generatedAt: new Date().toISOString(), text: report(result.state, date).replace('Prototyypin selaintiedot.', 'Yhteisen tietokannan tilannekuva.') });
      }
    } else if (request.method === 'POST' && url.pathname === '/api/actions') {
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'Pyyntö tulee väärästä osoitteesta.');
      if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Pyyntö pitää lähettää JSON-muodossa.');
      if (Number(request.headers.get('content-length')) > 65536) fail(413, 'Pyyntö on liian suuri.');
      const raw = await request.text();
      if (raw.length > 65536) fail(413, 'Pyyntö on liian suuri.');
      let command;
      try { command = JSON.parse(raw); } catch { fail(400, 'Virheellinen JSON.'); }
      if (!command || typeof command.action !== 'string' || typeof command.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(command.requestId) || !command.data || typeof command.data !== 'object' || Array.isArray(command.data)) fail(400, 'Tarkista pyynnön tiedot.');
      result = await store.update(identity, env.ADMIN_EMAIL, command);
      try { await deliverPending(store, env, env.SITE_URL || url.origin); } catch (error) { console.error('Ilmoitusten lähetys:', error.message); }
    } else fail(404, 'Rajapintaa ei löydy.');
    const visible = project(result.state, result.actor);
    delete visible.requests;
    delete visible.digestSent;
    // Push-tilauksista näytetään vain omat, ilman salausavaimia.
    visible.pushSubs = (result.state.pushSubs || []).filter(x => x.memberId === result.actor.id).map(({ id, endpoint, label, at }) => ({ id, endpoint, label, at }));
    const setup = result.actor.role === 'coordinator' ? { mail: mailConfigured(env), push: pushConfigured(env), cron: Boolean(env.CRON_TOKEN && env.CRON_TOKEN.length >= 24), siteUrl: Boolean(env.SITE_URL), lastDigest: Object.keys(result.state.digestSent || {}).sort().at(-1) || null } : undefined;
    return json({ revision: result.revision, state: visible, actor: result.actor, mail: mailConfigured(env), push: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null, setup, serverTime: new Date().toISOString() });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    // Domain validation errors are safe, user-facing messages. Database failures are not.
    if (error.message?.startsWith('D1_') || /SQLITE|database|no such table/i.test(error.message || '')) return json({ error: 'Tietokantayhteys ei toimi. Muutosta ei vahvistettu.' }, 503);
    return json({ error: error.message || 'Toiminto epäonnistui.' }, 400);
  }
}
