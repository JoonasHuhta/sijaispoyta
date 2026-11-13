import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { BoardStore, actorFor, execute, project, handleApi } from '../server/board.js';
import { seed } from '../public/domain.js';

const admin={id:'admin-user',email:'owner@example.test'};
const outsider={id:'other-user',email:'other@example.test'};
const sub={id:'elias-user',email:'elias@example.test'};
function database(initial){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_demonic_manta.sql',import.meta.url),'utf8'));
  if(initial)sqlite.prepare('INSERT INTO board (id, revision, body) VALUES (1, 0, ?)').run(JSON.stringify(initial));
  return { prepare(sql){return { bind(...args){return { async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}, async first(){return sqlite.prepare(sql).get(...args);} };}, async first(){return sqlite.prepare(sql).get();} };} };
}
function initial(){return {...seed(),members:[{id:'admin',userId:admin.id,email:admin.email,role:'coordinator',personId:null},{id:'sub',userId:sub.id,email:sub.email,role:'substitute',personId:'elias'}],requests:[]};}
const command=(action,data={},requestId=crypto.randomUUID())=>({action,data,requestId});
function request(path,identity=admin,body,extra={}){
  return new Request('https://school.test'+path,{method:body?'POST':'GET',headers:{...(identity?{'oai-authenticated-user-id':identity.id,'oai-authenticated-user-email':identity.email}:{}),...(body?{'content-type':'application/json','origin':'https://school.test'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
}
test('Vain määritetty omistaja voi ottaa ensimmäisen vastaavan roolin',()=>{
  const s={...seed(),members:[]};
  assert.equal(actorFor(s,admin,admin.email).role,'coordinator');
  assert.throws(()=>actorFor(s,outsider,admin.email),/ei ole liitetty/);
  assert.throws(()=>actorFor(s,null,admin.email),/Kirjaudu/);
});
test('Liitetty tunnus käyttää pysyvää käyttäjätunnistetta sähköpostin vaihduttua',()=>{
  assert.equal(actorFor(initial(),{...sub,email:'changed@example.test'},admin.email).personId,'elias');
  assert.throws(()=>actorFor(initial(),{...outsider,email:sub.email},admin.email),/ei ole liitetty/);
});
test('Sijainen ei voi vahvistaa tehtävää, lisätä henkilöä tai lukea koko poolia',()=>{
  const s=initial(),actor=actorFor(s,sub);
  for(const action of ['confirm','cancel','addPerson','member','revokeMember','resetDemo'])assert.throws(()=>execute(s,actor,action,{}),/sijaisvastaavalle/);
  const view=project(s,actor);
  assert.deepEqual(view.people.map(p=>p.id),['elias']);
  assert.ok(view.availability.every(a=>a.personId==='elias'));
  assert.equal(view.members,undefined);
  assert.equal(view.needs.find(n=>n.id==='n1').notes,'');
  assert.equal(view.needs.find(n=>n.id==='n1').teacherId,'');
  assert.equal(view.needs.some(n=>n.id==='n3'),false);
});
test('Sijainen ei voi esiintyä toisena henkilönä',()=>{
  const s=initial();execute(s,actorFor(s,sub),'apply',{id:'n1',personId:'sofia'});
  assert.deepEqual(s.needs[0].applicants,['elias']);
  assert.throws(()=>execute(s,actorFor(s,sub),'removeAvailability',{id:'av1'}),/omaa saatavuuttasi/);
  assert.throws(()=>execute(s,actorFor(s,sub),'addNeed',{}),/oma henkilöstö/);
});
test('Samanaikaiset vahvistukset samalle tehtävälle: vain yksi voittaa',async()=>{
  const s=initial();s.availability.find(a=>a.personId==='sofia').start='08:30';s.needs[0].applicants=['elias','sofia'];
  const db=database(s);
  const results=await Promise.allSettled(['elias','sofia'].map(personId=>new BoardStore(db).update(admin,admin.email,command('confirm',{id:'n1',personId}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const final=await new BoardStore(db).read();assert.equal(final.revision,1);assert.ok(final.state.needs[0].assignedId);
});
test('Samanaikaiset päällekkäiset tehtävät eivät voi varata samaa sijaista',async()=>{
  const s=initial();s.needs[1].start='09:00';s.needs[1].end='10:00';s.needs[0].applicants=['elias'];s.needs[1].applicants=['elias'];
  const db=database(s);
  const results=await Promise.allSettled(['n1','n2'].map(id=>new BoardStore(db).update(admin,admin.email,command('confirm',{id,personId:'elias'}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await new BoardStore(db).read()).state.needs.filter(n=>n.assignedId==='elias').length,1);
});
test('Saman pyynnön uusinta ei lisää henkilöä kahdesti',async()=>{
  const store=new BoardStore(database(initial())),c=command('addPerson',{name:'Kokeilu',kind:'pool'});
  await store.update(admin,admin.email,c);await store.update(admin,admin.email,c);
  const final=await store.read();assert.equal(final.revision,1);assert.equal(final.state.people.length,6);
});
test('Kaksi rinnakkaista lisäystä säilyvät molemmat',async()=>{
  const store=new BoardStore(database(initial()));
  await Promise.all(['Ensimmäinen','Toinen'].map(name=>store.update(admin,admin.email,command('addPerson',{name,kind:'pool'}))));
  const final=await store.read();assert.equal(final.revision,2);assert.equal(final.state.people.length,7);
});
test('Kutsu sidotaan käyttäjätunnisteeseen ensimmäisessä tallennuksessa ja peruutus poistaa oikeudet',async()=>{
  const s=initial();s.members[1].userId=null;const store=new BoardStore(database(s));
  const {state}=await store.update(sub,admin.email,command('apply',{id:'n1'}));
  assert.equal(state.members[1].userId,sub.id);
  const removed=await store.update(admin,admin.email,command('revokeMember',{id:'sub'}));
  assert.throws(()=>actorFor(removed.state,sub,admin.email),/ei ole liitetty/);
});
test('Rajapinta estää anonyymin, tuntemattoman ja sivuston ulkopuolisen kirjoituksen',async()=>{
  const env={DB:database(initial()),ADMIN_EMAIL:admin.email};
  assert.equal((await handleApi(request('/api/state',null),env)).status,401);
  assert.equal((await handleApi(request('/api/state',outsider),env)).status,403);
  assert.equal((await handleApi(request('/api/actions',admin,command('apply',{id:'n1',personId:'elias'}),{origin:'https://other.test'}),env)).status,403);
  assert.equal((await handleApi(request('/api/report',sub),env)).status,403);
});
test('Rajapinnan muutos näkyy toisessa lukijassa ja raportissa',async()=>{
  const env={DB:database(initial()),ADMIN_EMAIL:admin.email};
  assert.equal((await handleApi(request('/api/actions',sub,command('apply',{id:'n1'})),env)).status,200);
  assert.equal((await handleApi(request('/api/actions',admin,command('confirm',{id:'n1',personId:'elias'})),env)).status,200);
  const data=await (await handleApi(request('/api/state',sub),env)).json();
  assert.equal(data.state.needs.find(n=>n.id==='n1').assignedId,'elias');
  assert.ok(data.state.needs.find(n=>n.id==='n1').notes);
  const report=await (await handleApi(request('/api/report',admin),env)).json();assert.match(report.text,/VAHVISTETTU: Elias Lehto/);
});

test('Ilmoitukset menevät oikeille ihmisille', () => {
  const s = initial(), coord = actorFor(s, admin, admin.email), elias = actorFor(s, sub);
  execute(s, elias, 'apply', { id: 'n1' });
  let mine = s.notifications.filter(n => n.to === 'coordinator');
  assert.equal(mine.length, 1); assert.match(mine[0].text, /Elias Lehto ilmoittautui/);
  execute(s, coord, 'confirm', { id: 'n1', personId: 'elias' });
  assert.match(s.notifications.find(n => n.to === 'elias').text, /vahvistettu sijaiseksi/);
  assert.match(s.notifications.find(n => n.to === 'anna').text, /Sijaisesi on vahvistettu: Elias Lehto/);
  execute(s, coord, 'cancel', { id: 'n1' });
  assert.equal(s.notifications.filter(n => n.to === 'elias').length, 2);
  assert.match(s.notifications.filter(n => n.to === 'anna').at(-1).text, /avautui uudelleen/);
  // Sijainen näkee vain omat ilmoituksensa ja voi kuitata vain ne.
  const view = project(s, elias);
  assert.ok(view.notifications.length === 2 && view.notifications.every(n => n.to === 'elias'));
  execute(s, elias, 'markRead', { ids: 'all' });
  assert.ok(s.notifications.filter(n => n.to === 'elias').every(n => n.read));
  assert.ok(s.notifications.filter(n => n.to !== 'elias').every(n => !n.read));
});
test('Oma toiminto ei tee ilmoitusta itselle', () => {
  const s = initial(), coord = actorFor(s, admin, admin.email);
  execute(s, coord, 'addNeed', { teacherId: 'pekka', date: s.needs[0].date, start: '13:00', end: '14:00', group: '5. luokka', subject: 'Musiikki' });
  assert.equal(s.notifications.filter(n => n.to === 'coordinator').length, 0);
});

import { buildDigest, nextSchoolDay } from '../server/digest.js';
import { emailsFor, deliverPending, runDigest } from '../server/mail.js';
const mailEnv = { RESEND_API_KEY: 're_test', MAIL_FROM: 'Sijaispöytä <sijaispoyta@koulu.test>', CRON_TOKEN: 'x'.repeat(32) };
function fakeFetch() { const sent = []; const f = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }; f.sent = sent; return f; }

test('Aamukooste kertoo sijaisvastaavalle avoimet ja sijaiselle oman päivän', () => {
  const s = seed(), d = buildDigest(s, s.needs[0].date);
  assert.match(d.coordinator.text, /3 sijaisuutta – 1 vahvistettu, 1 odottaa vahvistusta, 1 ilman ilmoittautuneita/);
  assert.match(d.coordinator.text, /ODOTTAA VAHVISTUSTA – ilmoittautuneet: Sofia Salo/);
  assert.equal(d.coordinator.needsAction, 2);
  assert.match(d.people.maija.text, /Sijaisuus tänään: 11:15–12:00/);
  assert.match(d.people.anna.text, /sijaista ei ole vielä vahvistettu/);
  assert.equal(buildDigest({ ...s, needs: [] }, s.needs[0].date).coordinator, null);
  assert.equal(nextSchoolDay('2026-11-13'), '2026-11-16');
});
test('Sähköposti vain niille, jotka ovat sen ottaneet käyttöön', () => {
  const s = initial(), elias = actorFor(s, sub);
  assert.deepEqual(emailsFor(s, 'elias', 'notify'), []);
  execute(s, elias, 'emailPrefs', { notify: true, digest: false });
  assert.deepEqual(emailsFor(s, 'elias', 'notify'), [sub.email]);
  assert.deepEqual(emailsFor(s, 'elias', 'digest'), []);
  assert.deepEqual(project(s, elias).emailPrefs, { sub: { notify: true, digest: false } });
});
test('Ilmoitussähköposti lähtee kerran, ja ilman asetuksia ei lähde mitään', async () => {
  const s = initial(); s.emailPrefs = { admin: { notify: true, digest: true } };
  const db = database(s), store = new BoardStore(db), f = fakeFetch();
  await store.update(sub, admin.email, command('apply', { id: 'n1' }));
  assert.deepEqual(await deliverPending(store, {}, 'https://school.test', f), { sent: 0, configured: false });
  assert.equal((await deliverPending(store, mailEnv, 'https://school.test', f)).sent, 1);
  assert.equal(f.sent[0].to[0], admin.email); assert.match(f.sent[0].subject, /Uusi ilmoittautuminen/); assert.match(f.sent[0].text, /need=n1/);
  assert.equal((await deliverPending(store, mailEnv, 'https://school.test', f)).sent, 0);
});
test('Aamukooste lähtee kerran päivässä ja tulos ei sisällä henkilötietoja', async () => {
  const s = initial(); s.emailPrefs = { admin: { notify: false, digest: true }, sub: { notify: false, digest: true } };
  s.needs[0].applicants = ['elias']; s.needs[0].assignedId = 'elias';
  const store = new BoardStore(database(s)), f = fakeFetch(), date = s.needs[0].date;
  const dry = await runDigest(store, mailEnv, { origin: 'https://school.test', date, dry: true, fetcher: f });
  assert.deepEqual(dry, { dry: true, date, wouldSend: 2, wouldPush: 0 }); assert.equal(f.sent.length, 0);
  const first = await runDigest(store, mailEnv, { origin: 'https://school.test', date, fetcher: f });
  assert.equal(first.sent, 2); assert.doesNotMatch(JSON.stringify(first), /@|Elias|Anna/);
  assert.equal((await runDigest(store, mailEnv, { origin: 'https://school.test', date, fetcher: f })).alreadySent, true);
  assert.equal(f.sent.length, 2);
});
test('Ajastusrajapinta vaatii oikean tokenin', async () => {
  const db = database(initial());
  const call = token => handleApi(new Request('https://school.test/api/cron/digest?dry=1', { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {} }), { DB: db, ...mailEnv });
  assert.equal((await call()).status, 401);
  assert.equal((await call('y'.repeat(32))).status, 401);
  const ok = await call(mailEnv.CRON_TOKEN); assert.equal(ok.status, 200);
  assert.equal((await handleApi(new Request('https://school.test/api/cron/digest', { method: 'POST', headers: { authorization: 'Bearer ' + mailEnv.CRON_TOKEN } }), { DB: db })).status, 503);
});

import { generateVapidKeys, b64u } from '../server/webpush.js';
async function browserSub(host = 'https://fcm.googleapis.com/fcm/send/') {
  const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { endpoint: host + crypto.randomUUID(), keys: { p256dh: b64u.encode(await crypto.subtle.exportKey('raw', k.publicKey)), auth: b64u.encode(crypto.getRandomValues(new Uint8Array(16))) } };
}
test('Puhelinilmoitukset: tilaus, kokeilu, oikeat vastaanottajat ja vanhentuneen tilauksen poisto', async () => {
  const vapid = await generateVapidKeys(), env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
  const s = initial(), db = database(s), store = new BoardStore(db);
  await assert.rejects(store.update(sub, admin.email, command('pushSubscribe', { subscription: { endpoint: 'https://evil.example/x', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } } })), /ei kelpaa/);
  const eliasPhone = await browserSub(), adminPhone = await browserSub('https://web.push.apple.com/');
  await store.update(sub, admin.email, command('pushSubscribe', { subscription: eliasPhone, label: 'Android' }));
  await store.update(admin, admin.email, command('pushSubscribe', { subscription: adminPhone, label: 'iPhone' }));
  const calls = []; const f = async (url, init) => { calls.push({ url, auth: init.headers.Authorization, enc: init.headers['Content-Encoding'] }); return new Response(null, { status: url === adminPhone.endpoint && calls.length > 2 ? 410 : 201 }); };
  // Kokeiluilmoitus menee vain omalle laitteelle.
  await store.update(sub, admin.email, command('pushTest'));
  let r = await deliverPending(store, env, 'https://school.test', f);
  assert.equal(r.pushed, 1); assert.equal(calls[0].url, eliasPhone.endpoint); assert.equal(calls[0].enc, 'aes128gcm'); assert.match(calls[0].auth, /^vapid t=.+, k=/);
  // Ilmoittautuminen → sijaisvastaavan puhelin; vahvistus → Eliaksen puhelin.
  await store.update(sub, admin.email, command('apply', { id: 'n1' }));
  r = await deliverPending(store, env, 'https://school.test', f); assert.equal(calls.at(-1).url, adminPhone.endpoint); assert.equal(r.pushed, 1);
  await store.update(admin, admin.email, command('confirm', { id: 'n1', personId: 'elias' }));
  r = await deliverPending(store, env, 'https://school.test', f); assert.equal(calls.at(-1).url, eliasPhone.endpoint);
  // Palvelu vastaa 410 → tilaus poistetaan.
  const gone = async url => new Response(null, { status: url === adminPhone.endpoint ? 410 : 201 });
  await store.update(sub, admin.email, command('apply', { id: 'n2' })).catch(() => {});
  await store.update(sub, admin.email, command('availability', { date: s.needs[0].date, start: '15:00', end: '16:00' }));
  await deliverPending(store, env, 'https://school.test', gone);
  const after = (await store.read()).state;
  assert.equal(after.pushSubs.some(x => x.endpoint === adminPhone.endpoint), false);
  assert.equal(after.pushSubs.some(x => x.endpoint === eliasPhone.endpoint), true);
  // Rajapinta ei paljasta salausavaimia eikä muiden laitteita.
  const res = await (await handleApi(request('/api/state', sub), { DB: db, ...env })).json();
  assert.equal(res.push, vapid.publicKey);
  assert.ok(res.state.pushSubs.every(x => !x.p256dh && !x.auth));
  assert.ok(res.state.pushSubs.every(x => x.endpoint !== adminPhone.endpoint));
});
test('Aamukooste lähtee myös puhelimeen', async () => {
  const vapid = await generateVapidKeys(), env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
  const s = initial(), store = new BoardStore(database(s)), date = s.needs[0].date;
  await store.update(admin, admin.email, command('pushSubscribe', { subscription: await browserSub() }));
  const urls = []; const f = async url => { urls.push(url); return new Response(null, { status: 201 }); };
  const r = await runDigest(store, env, { origin: 'https://school.test', date, fetcher: f });
  assert.deepEqual({ sent: r.sent, pushed: r.pushed }, { sent: 0, pushed: 1 });
});
