import { today, candidates, eligibility, status } from './domain.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const params = new URLSearchParams(location.search);

// Testitila: GitHub Pages, ?demo tai paikallinen demopalvelin. Muuten käytetään yhteistä palvelinta.
const DEMO = location.hostname.endsWith('github.io') || params.has('demo') || document.documentElement.dataset.mode === 'demo' || location.protocol === 'file:';
let demo = null;

let state = { people: [], availability: [], needs: [], events: [], members: [], notifications: [] }, actor, seen = null, revision = -1, tab = 'board', filter = 'all', busy = false, toastTimer;

const admin = () => actor?.role === 'coordinator';
const date = () => $('#date').value;
const person = id => state.people.find(p => p.id === id);
const name = id => person(id)?.name || 'Opettaja';
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const self = () => admin() ? $('#self-person').value : actor?.personId;
const kindText = k => k === 'staff' ? 'Oma henkilöstö' : 'Sijaispooli';
const options = (people, selected) => people.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${p.kind === 'staff' ? 'oma henkilöstö' : 'sijaispooli'}</option>`).join('');
const reason = (n, id) => admin() ? eligibility(state, n, id) : n._reason;
const label = n => ({ open: 'Avoin', pending: 'Odottaa vahvistusta', confirmed: 'Vahvistettu' })[status(n)];
const minutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const duration = n => { const d = minutes(n.end) - minutes(n.start); return d >= 60 && d % 60 === 0 ? `${d / 60} h` : d > 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d} min`; };
const shift = (d, delta) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); };
function dayName(d) {
  const t = new Date(d + 'T12:00:00Z');
  const text = t.toLocaleDateString('fi-FI', { weekday: 'long', timeZone: 'UTC' }) + ' ' + t.getUTCDate() + '.' + (t.getUTCMonth() + 1) + '.';
  const rel = d === today() ? ' · tänään' : d === shift(today(), 1) ? ' · huomenna' : d === shift(today(), -1) ? ' · eilen' : '';
  return text.charAt(0).toUpperCase() + text.slice(1) + rel;
}

$('#date').value = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : today();

function message(text, error = false) {
  const el = $('#message');
  el.textContent = text; el.className = error ? 'error' : ''; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, error ? 7000 : 4000);
}

async function api(path, init) {
  if (DEMO) return demo.request(path, init);
  const response = await fetch(path, { cache: 'no-store', ...init });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Yhteys vaatii kirjautumisen. Avaa sivu uudelleen tai kirjaudu ChatGPT:llä.');
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Yhteys epäonnistui.'); return data;
}
function accept(data) {
  if (data.revision < revision) return;
  state = data.state; actor = data.actor; revision = data.revision;
  if (!admin() && tab === 'board') tab = 'self';
  const sync = $('#sync'); sync.classList.remove('offline');
  sync.textContent = DEMO ? 'Tallennettu tähän selaimeen' : 'Yhteinen tilanne · päivitetty ' + new Date(data.serverTime).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
  $('#connection').hidden = true; $('#workspace').hidden = false; render();
  announce();
}

/* ---------- Ilmoitukset ---------- */
const myKey = () => admin() ? 'coordinator' : actor?.personId;
const myNotes = () => (state.notifications || []).filter(n => n.to === myKey()).sort((a, b) => b.at.localeCompare(a.at));
function announce() {
  const fresh = myNotes().filter(n => !n.read && seen && !seen.has(n.id));
  seen = new Set(myNotes().map(n => n.id));
  if (!fresh.length) return;
  $('#bell').classList.remove('ring'); void $('#bell').offsetWidth; $('#bell').classList.add('ring');
  message(fresh.length === 1 ? 'Uusi ilmoitus: ' + fresh[0].text : `${fresh.length} uutta ilmoitusta.`);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { for (const n of fresh.slice(0, 3)) new Notification('Sijaispöytä', { body: n.text, icon: './img/favicon.png', tag: n.id }); } catch { /* esim. mobiiliselain */ }
  }
}
function notesModal() {
  const list = myNotes();
  const ago = at => { const m = Math.round((Date.now() - new Date(at)) / 60000); return m < 1 ? 'juuri nyt' : m < 60 ? `${m} min sitten` : new Date(at).toLocaleString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const canAsk = 'Notification' in window && Notification.permission === 'default';
  modal('Ilmoitukset', `<div class="notes">${list.map(n => `<div class="note-item t-${esc(n.type)} ${n.read ? '' : 'unread'}"><span class="dot"></span><div><p>${esc(n.text)}</p><small>${esc(ago(n.at))}</small>${n.date ? `<button class="link" data-open-note="${esc(n.id)}">Näytä päivä</button>` : ''}</div></div>`).join('') || '<p class="muted">Ei ilmoituksia. Saat tiedon täällä, kun joku ilmoittautuu, sijaisuus vahvistetaan tai perutaan.</p>'}</div>
    <div class="note-tools">${canAsk ? '<button id="allow-push" class="ghost sm">Salli ilmoitukset tällä laitteella</button>' : '<span></span>'}${list.some(n => !n.read) ? '<button id="mark-read" class="primary sm">Merkitse luetuiksi</button>' : ''}</div>`);
  $('#allow-push')?.addEventListener('click', async () => { const r = await Notification.requestPermission(); $('#allow-push').textContent = r === 'granted' ? 'Selainilmoitukset sallittu ✓' : 'Ilmoituksia ei sallittu'; $('#allow-push').disabled = true; });
  $('#mark-read')?.addEventListener('click', async () => { try { await mutate('markRead', { ids: 'all' }); $('#modal').close(); } catch (e) { message(e.message, true); } });
}
async function refresh(silent = false) {
  if (busy || $('#modal').open) return;
  try { accept(await api('/api/state')); }
  catch (error) { $('#sync').textContent = 'Yhteyttä ei saatu'; $('#sync').classList.add('offline'); if (!silent || !actor) message(error.message, true); }
}
async function mutate(action, data, text) {
  if (busy) throw new Error('Odota edellisen tallennuksen valmistumista.'); busy = true;
  document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = true);
  try { accept(await api('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data, requestId: crypto.randomUUID() }) })); if (text) message(text); }
  catch (error) { try { accept(await api('/api/state')); } catch { /* näytetään alkuperäinen virhe */ } throw error; }
  finally { busy = false; document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = false); }
}

function modal(title, html, submit) {
  $('#modal-title').textContent = title; $('#modal-content').innerHTML = html; $('#modal-error').hidden = true;
  const form = $('#modal-content form');
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await submit(Object.fromEntries(new FormData(form))); $('#modal').close(); }
    catch (error) { $('#modal-error').textContent = error.message; $('#modal-error').hidden = false; }
  });
  $('#modal').showModal();
  ($('#modal-content input:not([type=hidden]):not([disabled]), #modal-content select:not([disabled]), #modal-content textarea, #modal-content .primary') || $('#close-modal')).focus();
}
function availabilityModal(personId) {
  const people = admin() ? state.people : state.people.filter(p => p.id === actor.personId);
  modal('Ilmoita saatavuus', `<form>
    <label>Henkilö<select name="personId" ${admin() ? '' : 'disabled'}>${options(people, personId)}</select></label>
    <label>Päivä<input type="date" name="date" required value="${esc(date())}"></label>
    <div class="form-row"><label>Alkaen<input name="start" type="time" value="08:30" required></label><label>Asti<input name="end" type="time" value="14:00" required></label></div>
    <p class="form-help">Saatavuus kertoo, milloin voit tulla. Se ei vielä varaa mitään tehtävää.</p>
    <div class="form-actions"><button type="button" class="ghost" data-close>Peruuta</button><button type="submit" class="primary">Tallenna saatavuus</button></div></form>`,
  data => mutate('availability', { ...data, personId: data.personId || personId }, 'Saatavuus tallennettu.'));
}

/* ---------- Kortit ---------- */
function timeBlock(n) {
  return `<div class="need-time"><strong>${esc(n.start)}</strong><span>– ${esc(n.end)}</span><em>${duration(n)}</em></div>`;
}
function needCard(n) {
  const st = status(n), free = candidates(state, n);
  let side;
  if (n.assignedId) {
    side = `<div class="assigned"><span class="avatar ${person(n.assignedId)?.kind || ''}">${esc(initials(name(n.assignedId)))}</span><div><strong>${esc(name(n.assignedId))}</strong><small>Vahvistettu sijainen</small></div></div>
      <button class="danger sm" data-action="cancel" data-id="${esc(n.id)}">Peru vahvistus</button>`;
  } else {
    if (n.applicants.length) {
      side = `<p class="next"><b>Valitse sijainen</b> ilmoittautuneista:</p><ul class="applicants">${n.applicants.map(id => {
        const why = reason(n, id);
        return `<li class="${why ? 'blocked' : ''}"><span>${esc(name(id))}<small>${why ? esc(why) : kindText(person(id)?.kind)}</small></span>${why ? '' : `<button class="success sm" data-action="confirm" data-id="${esc(n.id)}" data-person="${esc(id)}">Vahvista</button>`}</li>`;
      }).join('')}</ul>`;
    } else {
      side = `<p class="next"><b>Ei vielä ilmoittautuneita.</b><br><small>${free.length ? `${free.length} ${free.length === 1 ? 'henkilöllä' : 'henkilöllä'} on saatavuus koko ajalle.` : 'Kenelläkään ei ole ilmoitettua saatavuutta koko ajalle.'}</small></p>`;
    }
    side += `<div class="row"><button class="ghost sm" data-action="candidates" data-id="${esc(n.id)}">Käytettävissä (${free.length})</button><button class="ghost sm" data-action="request" data-id="${esc(n.id)}">Kopioi viesti</button></div>`;
  }
  return `<article class="need ${st}" data-need="${esc(n.id)}">${timeBlock(n)}
    <div><div class="need-head"><span class="badge ${st}">${label(n)}</span><span class="group">${esc(n.group)}</span></div>
      <h3>${esc(n.subject)}</h3>
      <dl class="meta"><div><dt>Poissa:</dt><dd>${esc(name(n.teacherId))}</dd></div><div><dt>Vastaava:</dt><dd>${esc(n.owner || 'nimeämättä')}</dd></div></dl>
      ${n.notes ? `<p class="note">${esc(n.notes)}</p>` : ''}</div>
    <div class="need-side">${side}</div></article>`;
}
function selfCard(n, id) {
  const why = reason(n, id);
  let badge, side;
  if (n.assignedId === id) {
    badge = '<span class="badge confirmed">Vahvistettu sinulle</span>';
    side = `<p class="next"><b>Tämä sijaisuus on sinun.</b></p><small>Jos et pääse paikalle, ota heti yhteys sijaisvastaavaan.</small>`;
  } else if (n.applicants.includes(id)) {
    badge = '<span class="badge pending">Ilmoittauduttu</span>';
    side = `<p class="next"><b>Odottaa vahvistusta.</b><br><small>${esc(why || 'Sijaisvastaava vahvistaa valinnan.')}</small></p><button class="danger sm" data-action="withdraw" data-id="${esc(n.id)}">Peru ilmoittautuminen</button>`;
  } else if (n.teacherId === id) {
    badge = `<span class="badge ${status(n)}">Oma poissaolo · ${label(n).toLowerCase()}</span>`;
    side = `<small>Sijaisvastaava etsii tähän sijaisen.</small>`;
  } else {
    badge = '<span class="badge open">Avoin</span>';
    side = `<button class="success" data-action="apply" data-id="${esc(n.id)}" ${why ? 'disabled' : ''}>Voin sijaistaa</button>${why ? `<small>${esc(why)}</small>${/saatavuus/i.test(why) ? `<button class="link" data-action="availability" data-id="${esc(id)}">Ilmoita saatavuus tälle päivälle</button>` : ''}` : '<small>Ilmoittautuminen ei vielä sido. Sijaisvastaava vahvistaa.</small>'}`;
  }
  return `<article class="need ${n.assignedId === id ? 'confirmed' : n.applicants.includes(id) ? 'pending' : status(n)}" data-need="${esc(n.id)}">${timeBlock(n)}
    <div><div class="need-head">${badge}<span class="group">${esc(n.group)}</span></div>
      <h3>${esc(n.subject)}</h3>
      <dl class="meta"><div><dt>Yhteyshenkilö:</dt><dd>${esc(n.owner || 'sijaisvastaava')}</dd></div></dl>
      ${n.notes ? `<p class="note">${esc(n.notes)}</p>` : ''}</div>
    <div class="need-side">${side}</div></article>`;
}
function personCard(p) {
  const member = state.members?.find(m => m.personId === p.id), slots = state.availability.filter(a => a.personId === p.id && a.date === date());
  const canEdit = admin() || p.id === actor.personId;
  const linking = admin() && !DEMO ? (member
    ? `<p class="counts">Tunnus: ${esc(member.email)} · ${member.userId ? 'käytössä' : 'odottaa ensimmäistä kirjautumista'}</p><button class="link" data-action="revokeMember" data-id="${esc(member.id)}">Poista tunnuksen liitos</button>`
    : `<button class="link" data-action="member" data-id="${esc(p.id)}">Liitä kirjautumistunnus</button>`) : '';
  return `<article class="person"><div class="person-top"><span class="avatar ${p.kind}">${esc(initials(p.name))}</span><div><h3>${esc(p.name)}</h3><span class="kind">${p.kind === 'staff' ? 'Oma henkilöstö' : 'Ulkopuolinen sijaispooli'}</span></div></div>
    <p class="muted">${esc(p.skills || 'Osaamista ei vielä kuvattu')}</p>
    <div class="chips">${slots.map(a => `<span class="chip">${esc(a.start)}–${esc(a.end)}${canEdit ? `<button data-action="removeAvailability" data-id="${esc(a.id)}" aria-label="Poista saatavuus ${esc(a.start)}–${esc(a.end)}">×</button>` : ''}</span>`).join('') || '<span class="chip none">Ei ilmoitettua saatavuutta</span>'}</div>
    <div class="actions">${canEdit ? `<button class="ghost sm" data-action="availability" data-id="${esc(p.id)}">+ Saatavuus</button>` : ''}${linking}</div></article>`;
}

/* ---------- Näkymä ---------- */
function render() {
  const isAdmin = admin();
  // Ylätunniste ja roolit
  if (DEMO) {
    const sel = $('#demo-role');
    const all = demo.people();
    sel.innerHTML = `<option value="coordinator">Sijaisvastaava</option>` + all.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${p.kind === 'staff' ? 'opettaja' : 'sijainen'}</option>`).join('');
    sel.value = isAdmin ? 'coordinator' : actor.personId;
  } else {
    $('#identity').hidden = false;
    $('#identity').textContent = isAdmin ? 'Sijaisvastaava' : name(actor.personId);
  }
  const selected = self();
  $('#self-person').innerHTML = options(state.people, selected || state.people.find(p => p.kind === 'pool')?.id);
  $('#self-person-label').hidden = !isAdmin;
  $('#self-tab-label').textContent = isAdmin ? 'Sijaisen näkymä' : 'Omat sijaisuudet';
  document.querySelectorAll('[data-admin]').forEach(el => el.hidden = !isAdmin);
  $('#new-need').hidden = tab === 'people' || (!isAdmin && person(actor.personId)?.kind !== 'staff');

  const unread = myNotes().filter(n => !n.read).length;
  $('#bell').hidden = false; $('#bell-count').hidden = !unread; $('#bell-count').textContent = unread > 9 ? '9+' : unread;
  $('#bell').setAttribute('aria-label', unread ? `Ilmoitukset, ${unread} lukematonta` : 'Ilmoitukset');

  // Otsikko
  const heads = {
    board: ['Päivän sijaisuudet', 'Näet yhdellä silmäyksellä, mitkä tehtävät ovat avoinna, kuka on ilmoittautunut ja kuka on vahvistettu.'],
    self: isAdmin ? ['Sijaisen näkymä', 'Näin sijainen näkee päivän tehtävät. Valitse henkilö, jonka puolesta kokeilet ilmoittautumista.'] : [`Hei, ${esc(name(actor.personId).split(' ')[0])}!`, 'Ilmoittaudu tehtäviin, jotka sopivat sinulle. Sijaisvastaava vahvistaa valinnan.'],
    people: ['Henkilöt ja saatavuus', isAdmin ? 'Oma henkilöstö ja ulkopuolinen sijaispooli. Lisää saatavuus valitulle päivälle.' : 'Ilmoita, milloin olet käytettävissä.'],
  };
  $('#page-title').innerHTML = heads[tab][0]; $('#page-lead').textContent = heads[tab][1];
  $('#day-name').textContent = dayName(date());

  // Sijaisvastaavan pöytä
  const needs = state.needs.filter(n => n.date === date()).sort((a, b) => a.start.localeCompare(b.start));
  if (isAdmin) {
    const counts = { all: needs.length, open: 0, pending: 0, confirmed: 0 }; needs.forEach(n => counts[status(n)]++);
    const chips = [['all', 'Kaikki sijaisuudet'], ['open', 'Avoimet, ei ilmoittautuneita'], ['pending', 'Odottaa vahvistusta'], ['confirmed', 'Vahvistettu']];
    $('#stats').innerHTML = chips.map(([key, text]) => `<button class="filter ${key} ${filter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${filter === key}"><strong>${counts[key]}</strong><span>${text}</span></button>`).join('');
    const shown = needs.filter(n => filter === 'all' || status(n) === filter);
    $('#needs').innerHTML = shown.map(needCard).join('') || (needs.length
      ? `<div class="empty"><strong>Ei tähän suodattimeen osuvia sijaisuuksia.</strong><button class="link" data-filter="all">Näytä kaikki</button></div>`
      : `<div class="empty"><strong>Ei sijaisuuksia tälle päivälle.</strong>Kun opettaja on poissa, merkitse poissaolo yläreunan painikkeesta.</div>`);
  } else { $('#stats').innerHTML = ''; $('#needs').innerHTML = ''; }

  // Sijaisen näkymä
  const me = self();
  const mySlots = state.availability.filter(a => a.personId === me && a.date === date());
  $('#self-slots').innerHTML = mySlots.map(a => `<span class="chip">${esc(a.start)}–${esc(a.end)}<button data-action="removeAvailability" data-id="${esc(a.id)}" aria-label="Poista saatavuus">×</button></span>`).join('') || '<span class="chip none">Ei ilmoitettu</span>';
  const mine = needs.filter(n => n.assignedId === me);
  const applied = needs.filter(n => !n.assignedId && n.applicants.includes(me));
  const open = needs.filter(n => !n.assignedId && !n.applicants.includes(me) && n.teacherId !== me);
  const own = needs.filter(n => n.teacherId === me && n.assignedId !== me);
  const group = (title, list) => list.length ? `<h2 class="subhead">${title}</h2><div class="needs">${list.map(n => selfCard(n, me)).join('')}</div>` : '';
  $('#self-needs').innerHTML = (group('Sinulle vahvistetut', mine) + group('Ilmoittauduit – odottaa vahvistusta', applied) + group('Avoimet sijaisuudet', open) + group('Omat poissaolosi', own))
    || '<div class="empty"><strong>Ei avoimia sijaisuuksia tälle päivälle.</strong>Kokeile toista päivää tai ilmoita saatavuutesi, niin sijaisvastaava näkee sen.</div>';

  // Henkilöt
  const staff = state.people.filter(p => p.kind === 'staff'), pool = state.people.filter(p => p.kind === 'pool');
  const block = (title, list) => list.length ? `<h2 class="subhead">${title} (${list.length})</h2><div class="people-grid">${list.map(personCard).join('')}</div>` : '';
  $('#people').innerHTML = block('Ulkopuolinen sijaispooli', pool) + block('Oma henkilöstö', staff) || '<div class="empty">Ei henkilöitä.</div>';

  ['board', 'self', 'people'].forEach(id => $(`#${id}-view`).hidden = tab !== id);
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
}

function textDialog(title, text) {
  modal(title, '<textarea id="report-text" readonly aria-label="Kopioitava teksti"></textarea><div class="form-actions"><button id="copy-text" class="primary">Kopioi teksti</button></div>'); $('#report-text').value = text;
  $('#copy-text').addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); $('#copy-text').textContent = 'Kopioitu ✓'; } catch { $('#report-text').focus(); $('#report-text').select(); $('#copy-text').textContent = 'Valittu — kopioi Ctrl/Cmd+C'; } });
}
function guide() {
  modal('Näin testaat Sijaispöytää', `<ol class="guide">
    <li><b>Sijaisvastaavana</b> näet tämän päivän kolme esimerkkisijaisuutta. <span style="color:var(--open-ink)">Punainen</span> = avoin, <span style="color:var(--wait-ink)">keltainen</span> = odottaa vahvistusta, <span style="color:var(--ok-ink)">vihreä</span> = vahvistettu.</li>
    <li>Vaihda yläkulmasta rooliksi <b>Elias Lehto · sijainen</b> ja paina pääainetunnin kohdalla <b>Voin sijaistaa</b>.</li>
    <li>Vaihda takaisin <b>Sijaisvastaavaksi</b> ja vahvista Elias. Kokeile myös <b>Peru vahvistus</b>: tehtävä avautuu uudelleen.</li>
    <li>Merkitse uusi poissaolo ja lisää jollekulle saatavuus <b>Henkilöt ja saatavuus</b> -välilehdellä.</li>
    <li><b>Ilmoitukset:</b> avaa sivu kahteen välilehteen, toisessa sijaisvastaava ja toisessa Elias. Kun Elias ilmoittautuu, sijaisvastaavan kello soi. Vahvistuksesta tieto menee Eliakselle ja poissa olevalle opettajalle (Anna Aalto).</li>
    <li>Kokeile <b>Kopioi viesti</b> (WhatsApp-sijaispyyntö) ja <b>Tilanneraportti</b>.</li>
  </ol><p class="form-help" style="margin-top:14px">Kaikki tiedot ovat kuvitteellisia ja pysyvät vain tässä selaimessa. “Palauta esimerkkitilanne” sivun alareunassa aloittaa alusta.</p>
  <div class="form-actions"><button class="primary" data-close>Aloitetaan</button></div>`);
}

/* ---------- Tapahtumat ---------- */
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
$('#date').addEventListener('change', () => { if (!date()) $('#date').value = today(); render(); });
$('#prev-day').addEventListener('click', () => { $('#date').value = shift(date(), -1); render(); });
$('#next-day').addEventListener('click', () => { $('#date').value = shift(date(), 1); render(); });
$('#today').addEventListener('click', () => { $('#date').value = today(); render(); });
$('#refresh').addEventListener('click', () => refresh().then(() => message('Tilanne päivitetty.')));
$('#self-person').addEventListener('change', render);
$('#close-modal').addEventListener('click', () => { if (!busy) $('#modal').close(); });
$('#self-availability').addEventListener('click', () => availabilityModal(self()));
$('#demo-guide').addEventListener('click', guide);
$('#bell').addEventListener('click', notesModal);
$('#new-person').addEventListener('click', () => modal('Lisää henkilö', `<form><label>Nimi<input name="name" maxlength="100" required autocomplete="off"></label><label>Ryhmä<select name="kind"><option value="pool">Ulkopuolinen sijaispooli</option><option value="staff">Oma henkilöstö</option></select></label><label>Osaaminen<input name="skills" maxlength="200" placeholder="esim. luokanopetus 1–6, musiikki"></label><div class="form-actions"><button type="button" class="ghost" data-close>Peruuta</button><button class="primary" type="submit">Lisää henkilö</button></div></form>`, data => mutate('addPerson', data, DEMO ? 'Henkilö lisätty.' : 'Henkilö lisätty. Liitä seuraavaksi hänen kirjautumistunnuksensa.')));
$('#new-need').addEventListener('click', () => {
  const staff = state.people.filter(p => p.kind === 'staff');
  modal('Poissaolo ja sijaispyyntö', `<form>
    <label>Poissa oleva opettaja<select name="teacherId" ${admin() ? '' : 'disabled'}>${options(admin() ? staff : staff.filter(p => p.id === actor.personId), actor.personId)}</select></label>
    <label>Päivä<input name="date" type="date" required value="${esc(date())}"></label>
    <div class="form-row"><label>Alkaa<input name="start" type="time" required value="08:30"></label><label>Päättyy<input name="end" type="time" required value="10:00"></label></div>
    <div class="form-row"><label>Luokka tai ryhmä<input name="group" maxlength="100" required placeholder="esim. 3. luokka"></label><label>Tehtävä<input name="subject" maxlength="100" required placeholder="esim. Pääainetunti"></label></div>
    <label>Sijaisvastaava<input name="owner" maxlength="100"></label>
    <label>Käytännön ohjeet sijaiselle<textarea name="notes" maxlength="2000" placeholder="Missä materiaalit ovat, mitä tunnilla tehdään…"></textarea></label>
    <p class="form-help">Merkitse yksi tunti tai yhtenäinen kokonaisuus. Poissaolon syytä ei kirjata. Ohjeet näkyvät vain vahvistetulle sijaiselle.</p>
    <div class="form-actions"><button type="button" class="ghost" data-close>Peruuta</button><button class="primary" type="submit">Avaa sijaisuus</button></div></form>`,
  data => mutate('addNeed', { ...data, teacherId: data.teacherId || actor.personId }, 'Sijaisuus avattu.'));
});
$('#report-open').addEventListener('click', async () => { try { const r = await api('/api/report?date=' + encodeURIComponent(date())); textDialog('Päivän tilanneraportti', r.text + '\n\nHaettu ' + new Date(r.generatedAt).toLocaleString('fi-FI')); } catch (e) { message(e.message, true); } });
$('#history').addEventListener('click', () => {
  const labels = { addPerson: 'Henkilö lisätty', availability: 'Saatavuus lisätty', removeAvailability: 'Saatavuus poistettu', addNeed: 'Sijaisuus avattu', apply: 'Ilmoittautuminen', withdraw: 'Ilmoittautuminen peruttu', confirm: 'Sijainen vahvistettu', cancel: 'Vahvistus peruttu', member: 'Tunnus liitetty', revokeMember: 'Tunnuksen liitos poistettu', resetDemo: 'Esimerkit palautettu' };
  modal('Viimeisimmät muutokset', state.events.filter(e => labels[e.type]).slice(-30).reverse().map(e => `<div class="list-row"><span>${esc(labels[e.type])}${e.personId ? ' · ' + esc(name(e.personId)) : ''}</span><small>${esc(new Date(e.at).toLocaleString('fi-FI'))}</small></div>`).join('') || '<p class="muted">Ei vielä muutoksia.</p>');
});
$('#export').addEventListener('click', () => { const blob = new Blob([JSON.stringify({ ...state, revision, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `sijaispoyta-${date()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('#reset').addEventListener('click', () => modal('Palauta esimerkkitilanne', `<form><p>${DEMO ? 'Tämä palauttaa testiversion alkuperäiset esimerkkihenkilöt ja -sijaisuudet tähän selaimeen.' : 'Tämä korvaa yhteisen tietokannan esimerkkihenkilöt ja sijaisuudet kaikkien näkymissä. Vie tiedot ensin talteen tarvittaessa. Palautus on sallittu vain ilman sijaisiin liitettyjä kirjautumistunnuksia.'}</p><div class="form-actions"><button type="button" class="ghost" data-close>Peruuta</button><button class="primary" type="submit">Palauta esimerkit</button></div></form>`, () => mutate('resetDemo', {}, 'Esimerkkitilanne palautettu.')));
$('#demo-role').addEventListener('change', e => {
  demo.setRole(e.target.value); revision = -1; seen = null; tab = e.target.value === 'coordinator' ? 'board' : 'self';
  refresh().then(() => message(e.target.value === 'coordinator' ? 'Olet nyt sijaisvastaava.' : `Olet nyt ${name(actor.personId)}.`));
});

document.body.addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) { e.preventDefault(); if (!busy) $('#modal').close(); return; }
  const o = e.target.closest('[data-open-note]');
  if (o) { const n = myNotes().find(x => x.id === o.dataset.openNote); $('#modal').close(); if (n?.date) $('#date').value = n.date; tab = admin() ? 'board' : 'self'; filter = 'all'; render(); const card = n?.needId && [...document.querySelectorAll('.need')].find(c => c.dataset.need === n.needId && !c.closest('[hidden]')); if (card) { card.classList.add('focus'); card.scrollIntoView({ block: 'center' }); } return; }
  const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; render(); return; }
  const b = e.target.closest('[data-action]'); if (!b || busy) return;
  const action = b.dataset.action, id = b.dataset.id, n = state.needs.find(x => x.id === id);
  try {
    switch (action) {
      case 'availability': availabilityModal(id); break;
      case 'removeAvailability': await mutate(action, { id }, 'Saatavuus poistettu.'); break;
      case 'apply': await mutate(action, { id, personId: self() }, 'Ilmoittautuminen tallennettu. Odottaa vahvistusta.'); break;
      case 'withdraw': await mutate(action, { id, personId: self() }, 'Ilmoittautuminen peruttu.'); break;
      case 'confirm': await mutate(action, { id, personId: b.dataset.person }, `${name(b.dataset.person)} vahvistettu sijaiseksi.`); break;
      case 'cancel': modal('Peru vahvistus', `<form><p>Perutaanko henkilön <b>${esc(name(n.assignedId))}</b> sijaisuus klo ${esc(n.start)}–${esc(n.end)}? Tehtävä avautuu uudelleen ja muut voivat ilmoittautua.</p><div class="form-actions"><button type="button" class="ghost" data-close>Ei, pidä vahvistus</button><button class="primary" type="submit">Peru ja avaa tehtävä</button></div></form>`, () => mutate(action, { id }, 'Vahvistus peruttu. Tehtävä on taas avoin.')); break;
      case 'candidates': modal('Käytettävissä koko ajalle', `<p class="form-help" style="margin-bottom:10px">Näillä henkilöillä on ilmoitettu saatavuus koko tehtävän ajalle eikä päällekkäistä vahvistusta. Sijaisvastaava arvioi soveltuvuuden.</p>${candidates(state, n).map(p => `<div class="list-row"><span><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.skills)}</span></span><small>${kindText(p.kind)}${n.applicants.includes(p.id) ? ' · ilmoittautunut' : ''}</small></div>`).join('') || '<p class="muted">Kenelläkään ei ole ilmoitettua saatavuutta tälle ajalle.</p>'}`); break;
      case 'request': textDialog('Sijaispyyntö WhatsAppiin', `Sijaista tarvitaan ${dayName(n.date).replace(/ · .*/, '')} klo ${n.start}–${n.end}.\n${n.group}: ${n.subject}.\nYhteyshenkilö: ${n.owner || 'koulun sijaisvastaava'}.\n\nIlmoittaudu Sijaispöydässä:\n${location.origin}${location.pathname}?date=${encodeURIComponent(n.date)}&need=${encodeURIComponent(n.id)}\n\n${DEMO ? '(Testiversio: linkki avaa testisivun.)' : 'Linkki edellyttää sivuston käyttöoikeutta ja liitettyä tunnusta. Lähetä viesti itse sovittuun ryhmään.'}`); break;
      case 'member': modal('Liitä kirjautumistunnus', `<form><p>Henkilö: <strong>${esc(name(id))}</strong></p><label>ChatGPT-tilin sähköpostiosoite<input type="email" name="email" required maxlength="254"></label><p class="form-help">Tämä liittää tunnuksen henkilöön sovelluksessa. Sivuston käyttöoikeus myönnetään erikseen Sitesin jakamisasetuksista. Kutsuviestiä ei lähetetä.</p><div class="form-actions"><button type="button" class="ghost" data-close>Peruuta</button><button type="submit" class="primary">Liitä tunnus</button></div></form>`, data => mutate('member', { ...data, personId: id }, 'Tunnus liitetty. Tarkista myös sivuston jakamisasetukset.')); break;
      case 'revokeMember': modal('Poista tunnuksen liitos', '<form><p>Henkilö säilyy listassa, mutta tunnuksella ei voi enää käsitellä hänen saatavuuttaan tai tehtäviään.</p><div class="form-actions"><button type="button" class="ghost" data-close>Peruuta</button><button type="submit" class="primary">Poista liitos</button></div></form>', () => mutate(action, { id }, 'Tunnuksen liitos poistettu.')); break;
    }
  } catch (error) { message(error.message, true); }
});

/* ---------- Käynnistys ---------- */
if (DEMO) {
  document.documentElement.dataset.mode = 'demo';
  const { createDemo, DEMO_STORAGE_KEY } = await import('./demo.js');
  demo = await createDemo();
  $('#live-notice').hidden = true; $('#signout').hidden = true; $('#connection').hidden = true;
  $('#demo-notice').hidden = false; $('#demo-role-wrap').hidden = false;
  $('#footer-text').textContent = 'Sijaispöytä · testiversio · tiedot vain tässä selaimessa';
  window.addEventListener('storage', ev => { if (ev.key === DEMO_STORAGE_KEY) { revision = -1; refresh(true); } });
}
await refresh();
const focusId = params.get('need');
if (focusId) { const card = [...document.querySelectorAll('.need')].find(c => c.dataset.need === focusId && !c.closest('[hidden]')); if (card) { card.classList.add('focus'); card.scrollIntoView({ block: 'center' }); } }
if (DEMO) {
  try { if (!localStorage.getItem('sijaispoyta-demo-guided')) { localStorage.setItem('sijaispoyta-demo-guided', '1'); guide(); } } catch { /* ei tallennusta */ }
} else {
  setInterval(() => { if (!document.hidden) refresh(true); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
}
