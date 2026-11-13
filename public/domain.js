export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
}
export function uid() { return globalThis.crypto.randomUUID(); }
export function overlaps(a, b) { return a.date === b.date && a.start < b.end && b.start < a.end; }
export function validSlot(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) || s.start >= s.end) return false;
  const date = new Date(s.date + 'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === s.date;
}
export function seed() {
  const date = today();
  return {
    version: 1,
    people: [
      { id: 'anna', name: 'Anna Aalto', kind: 'staff', skills: 'Luokanopetus 1–6' },
      { id: 'pekka', name: 'Pekka Puro', kind: 'staff', skills: 'Ympäristöoppi, matematiikka' },
      { id: 'maija', name: 'Maija Metsä', kind: 'staff', skills: 'Luokanopetus, käsityö' },
      { id: 'elias', name: 'Elias Lehto', kind: 'pool', skills: 'Luokanopetus 1–6, steinerkokemus' },
      { id: 'sofia', name: 'Sofia Salo', kind: 'pool', skills: 'Ympäristöoppi, musiikki' }
    ],
    availability: [
      { id: 'av1', personId: 'maija', date, start: '10:15', end: '12:00' },
      { id: 'av2', personId: 'elias', date, start: '08:30', end: '14:00' },
      { id: 'av3', personId: 'sofia', date, start: '10:15', end: '14:00' }
    ],
    needs: [
      { id: 'n1', teacherId: 'anna', date, start: '08:30', end: '10:00', group: '3. luokka', subject: 'Pääainetunti', notes: 'Aamupiiri ja jakson vihkotyö. Ohjeet opettajan pöydällä.', owner: 'Sijaisvastaava A', applicants: [], assignedId: null },
      { id: 'n2', teacherId: 'pekka', date, start: '10:15', end: '11:00', group: '6. luokka', subject: 'Ympäristöoppi', notes: 'Kerrataan veden kiertokulkua. Luokka 6.', owner: 'Sijaisvastaava B', applicants: ['sofia'], assignedId: null },
      { id: 'n3', teacherId: 'anna', date, start: '11:15', end: '12:00', group: '3. luokka', subject: 'Käsityö', notes: 'Jatketaan keskeneräisiä töitä.', owner: 'Sijaisvastaava A', applicants: ['maija'], assignedId: 'maija' }
    ],
    events: []
  };
}
export function eligibility(state, need, personId) {
  if (!state.people.some(p => p.id === personId)) return 'Henkilöä ei löydy.';
  if (personId === need.teacherId || state.needs.some(n => n.teacherId === personId && overlaps(n, need))) return 'Henkilö on merkitty poissaolevaksi tänä aikana.';
  if (!state.availability.some(a => a.personId === personId && a.date === need.date && a.start <= need.start && a.end >= need.end)) return 'Ilmoitettu saatavuus ei kata koko sijaisuutta.';
  if (state.needs.some(n => n.id !== need.id && n.assignedId === personId && overlaps(n, need))) return 'Henkilöllä on päällekkäinen vahvistettu sijaisuus.';
  return null;
}
export function candidates(state, need) {
  return state.people.filter(p => !eligibility(state, need, p.id));
}
export function status(need) { return need.assignedId ? 'confirmed' : need.applicants.length ? 'pending' : 'open'; }
export function addPerson(state, data) {
  const name = String(data.name || '').trim();
  if (!name || name.length > 100 || !['staff', 'pool'].includes(data.kind)) throw new Error('Tarkista henkilön nimi ja ryhmä.');
  const person = { id: uid(), name, kind: data.kind, skills: String(data.skills || '').trim().slice(0, 200) };
  state.people.push(person); return person;
}
export function addAvailability(state, data) {
  if (!validSlot(data) || !state.people.some(p => p.id === data.personId)) throw new Error('Valitse henkilö, päivä ja kelvollinen aikaväli.');
  if (state.availability.some(a => a.personId === data.personId && a.date === data.date && a.start === data.start && a.end === data.end)) throw new Error('Tämä saatavuus on jo merkitty.');
  state.availability.push({ id: uid(), personId: data.personId, date: data.date, start: data.start, end: data.end });
}
export function removeAvailability(state, id) {
  const entry = state.availability.find(a => a.id === id);
  if (!entry) throw new Error('Saatavuutta ei löydy.');
  const remaining = state.availability.filter(a => a.id !== id);
  const dependent = state.needs.some(n => n.assignedId === entry.personId && !remaining.some(a => a.personId === entry.personId && a.date === n.date && a.start <= n.start && a.end >= n.end));
  if (dependent) throw new Error('Peru ensin tähän saatavuuteen liittyvä vahvistettu sijaisuus.');
  state.availability = remaining;
}
export function addNeed(state, data) {
  const teacher = state.people.find(p => p.id === data.teacherId && p.kind === 'staff');
  if (!teacher || !validSlot(data) || !String(data.group || '').trim() || !String(data.subject || '').trim()) throw new Error('Täytä opettaja, päivä, aikaväli, luokka ja tehtävä.');
  if (state.needs.some(n => n.teacherId === teacher.id && overlaps(n, data))) throw new Error('Tälle opettajalle on jo päällekkäinen poissaolo.');
  if (state.needs.some(n => n.assignedId === teacher.id && overlaps(n, data))) throw new Error('Opettajalla on samaan aikaan vahvistettu sijaisuus. Peru se ensin.');
  const need = { id: uid(), teacherId: teacher.id, date: data.date, start: data.start, end: data.end, group: String(data.group).trim().slice(0, 100), subject: String(data.subject).trim().slice(0, 100), notes: String(data.notes || '').trim().slice(0, 2000), owner: String(data.owner || '').trim().slice(0, 100), applicants: [], assignedId: null };
  state.needs.push(need); return need;
}
export function apply(state, id, personId) {
  const need = state.needs.find(n => n.id === id);
  if (!need || need.assignedId) throw new Error('Sijaisuus ei ole enää avoinna.');
  const error = eligibility(state, need, personId); if (error) throw new Error(error);
  if (need.applicants.includes(personId)) throw new Error('Olet jo ilmoittautunut.');
  need.applicants.push(personId);
}
export function confirmAssignment(state, id, personId) {
  const need = state.needs.find(n => n.id === id);
  if (!need || need.assignedId) throw new Error('Sijaisuus on jo vahvistettu tai sitä ei löydy.');
  if (!need.applicants.includes(personId)) throw new Error('Vahvista vain ilmoittautunut henkilö.');
  const error = eligibility(state, need, personId); if (error) throw new Error(error);
  need.assignedId = personId;
  state.events.push({ at: new Date().toISOString(), type: 'confirmed', needId: id, personId });
}
export function cancelAssignment(state, id) {
  const need = state.needs.find(n => n.id === id);
  if (!need?.assignedId) throw new Error('Vahvistettua sijaista ei löydy.');
  const personId = need.assignedId;
  need.assignedId = null;
  need.applicants = need.applicants.filter(x => x !== personId);
  state.events.push({ at: new Date().toISOString(), type: 'cancelled', needId: id, personId });
}
export function report(state, date) {
  const needs = state.needs.filter(n => n.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const name = id => state.people.find(p => p.id === id)?.name || 'Tuntematon';
  const confirmed = needs.filter(n => n.assignedId).length;
  return [`SIJAISPÖYTÄ — ${date}`, `${needs.length} sijaisuutta · ${confirmed} vahvistettu · ${needs.length - confirmed} vahvistamatta`, '', ...needs.map(n => `${n.start}–${n.end} | ${n.group} · ${n.subject} | ${n.assignedId ? 'VAHVISTETTU: ' + name(n.assignedId) : 'AVOIN: ' + n.applicants.length + ' ilmoittautunutta, ' + candidates(state, n).length + ' ajallisesti käytettävissä'} | Vastaava: ${n.owner || 'nimeämättä'}`), '', 'Prototyypin selaintiedot. Saatavuus ei yksin osoita tehtävään soveltuvuutta.'].join('\n');
}
