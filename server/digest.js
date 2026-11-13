// Aamukooste: puhdas funktio, joka tekee tilasta päivän yhteenvedot.
// Käytössä palvelimella (sähköposti) ja sovelluksessa (esikatselu, myös testiversiossa).
import { candidates, status } from '../domain.js';

const shift = (d, delta) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); };
export function nextSchoolDay(date) {
  let d = shift(date, 1);
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = shift(d, 1);
  return d;
}
export function dayLabel(date) {
  const t = new Date(date + 'T12:00:00Z');
  return t.toLocaleDateString('fi-FI', { weekday: 'short', timeZone: 'UTC' }) + ' ' + t.getUTCDate() + '.' + (t.getUTCMonth() + 1) + '.';
}

/**
 * Palauttaa { coordinator, people } jossa coordinator = { subject, text, needsAction } tai null,
 * people = { [personId]: { subject, text } }.
 */
export function buildDigest(state, date) {
  const name = id => state.people.find(p => p.id === id)?.name || 'Tuntematon';
  const byDay = d => state.needs.filter(n => n.date === d).sort((a, b) => a.start.localeCompare(b.start));
  const today = byDay(date), next = nextSchoolDay(date), upcoming = byDay(next);
  const line = n => `${n.start}–${n.end} ${n.group} · ${n.subject}`;
  const people = {};
  const add = (id, text) => { (people[id] ||= []).push(text); };

  for (const n of today) {
    if (n.assignedId) add(n.assignedId, `Sijaisuus tänään: ${line(n)}.${n.owner ? ` Yhteyshenkilö: ${n.owner}.` : ''}${n.notes ? `\nOhjeet: ${n.notes}` : ''}`);
    add(n.teacherId, n.assignedId ? `Poissaolosi tänään ${line(n)}: sijaisena ${name(n.assignedId)}.` : `Poissaolosi tänään ${line(n)}: sijaista ei ole vielä vahvistettu.`);
  }
  for (const n of upcoming) if (n.assignedId) add(n.assignedId, `Tuleva sijaisuus ${dayLabel(next)}: ${line(n)}.`);

  let coordinator = null;
  if (today.length || upcoming.length) {
    const section = (title, list) => {
      if (!list.length) return [`${title}: ei sijaisuuksia.`];
      const c = { open: 0, pending: 0, confirmed: 0 }; list.forEach(n => c[status(n)]++);
      const rows = list.map(n => {
        const st = status(n);
        const detail = st === 'confirmed' ? `vahvistettu: ${name(n.assignedId)}`
          : st === 'pending' ? `ODOTTAA VAHVISTUSTA – ilmoittautuneet: ${n.applicants.map(name).join(', ')}`
          : `AVOIN – ei ilmoittautuneita, ${candidates(state, n).length} käytettävissä`;
        return `• ${line(n)} (poissa ${name(n.teacherId)}): ${detail}`;
      });
      return [`${title}: ${list.length} sijaisuutta – ${c.confirmed} vahvistettu, ${c.pending} odottaa vahvistusta, ${c.open} ilman ilmoittautuneita.`, ...rows];
    };
    const needsAction = [...today, ...upcoming].filter(n => !n.assignedId).length;
    coordinator = {
      needsAction,
      subject: needsAction ? `Aamukooste ${dayLabel(date)}: ${needsAction} sijaisuutta vailla vahvistusta` : `Aamukooste ${dayLabel(date)}: kaikki sijaisuudet vahvistettu`,
      text: [`Hyvää huomenta! Tässä Sijaispöydän tilanne: ${dayLabel(date)}`, '', ...section(`Tänään ${dayLabel(date)}`, today), '', ...section(`Seuraava koulupäivä ${dayLabel(next)}`, upcoming)].join('\n'),
    };
  }
  const personal = {};
  for (const [id, items] of Object.entries(people)) personal[id] = { subject: `Sijaispöytä ${dayLabel(date)}: päiväsi tilanne`, text: [`Hyvää huomenta, ${name(id).split(' ')[0]}!`, '', ...items].join('\n') };
  return { date, next, coordinator, people: personal };
}
