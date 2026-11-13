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
