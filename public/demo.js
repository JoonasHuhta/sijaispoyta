// Selaimessa toimiva testitila (GitHub Pages / paikallinen demo).
// Käyttää täsmälleen samoja sääntöjä kuin palvelin: server/board.js (execute, project)
// ja public/domain.js. Tiedot tallentuvat vain tämän selaimen localStorageen.
import { seed, today, report } from './domain.js';

const KEY = 'sijaispoyta-demo-v2';
const ROLE_KEY = KEY + '-role';

const memory = {};
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return memory[key] ?? null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { memory[key] = value; } },
};

export async function createDemo() {
  // _site/-rakenteessa board.js on kansiossa ./server/, suoraan repon juuresta julkaistuna ../server/.
  let board;
  try { board = await import('./server/board.js'); } catch { board = await import('../server/board.js'); }
  const { execute, project } = board;
  let role = storage.get(ROLE_KEY) || 'coordinator';

  const fresh = () => ({ revision: 0, state: { ...seed(), members: [], requests: [] } });
  function load() {
    try {
      const saved = JSON.parse(storage.get(KEY));
      if (saved?.state?.people && Array.isArray(saved.state.needs)) return saved;
    } catch { /* korvataan esimerkeillä */ }
    const data = fresh();
    save(data);
    return data;
  }
  function save(data) { storage.set(KEY, JSON.stringify(data)); }
  function actorFor(state) {
    if (role !== 'coordinator' && state.people.some(p => p.id === role)) {
      return { id: 'demo-' + role, userId: 'demo-' + role, email: '', role: 'substitute', personId: role };
    }
    return { id: 'demo-coordinator', userId: 'demo-coordinator', email: '', role: 'coordinator', personId: null };
  }
  function respond(data) {
    const actor = actorFor(data.state);
    const visible = project(data.state, actor);
    delete visible.requests;
    return { revision: data.revision, state: visible, actor, serverTime: new Date().toISOString() };
  }

  return {
    get role() { return role; },
    setRole(next) { role = next; storage.set(ROLE_KEY, next); },
    people() { return load().state.people; },
    wipe() { const data = fresh(); save(data); return data; },
    async request(path, options = {}) {
      const url = new URL(path, location.href);
      const data = load();
      if (url.pathname.endsWith('/api/report')) {
        if (actorFor(data.state).role !== 'coordinator') throw new Error('Raportti kuuluu sijaisvastaavalle.');
        const date = url.searchParams.get('date') || today();
        return { date, revision: data.revision, generatedAt: new Date().toISOString(), text: report(data.state, date).replace('Prototyypin selaintiedot.', 'Testiversion tiedot tästä selaimesta.') };
      }
      if ((options.method || 'GET') === 'POST') {
        const command = JSON.parse(options.body);
        const state = structuredClone(data.state);
        execute(state, actorFor(state), command.action, command.data || {});
        const next = { revision: data.revision + 1, state };
        save(next);
        return respond(next);
      }
      return respond(data);
    },
  };
}

export const DEMO_STORAGE_KEY = KEY;
