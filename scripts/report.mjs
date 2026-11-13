import { readFile } from 'node:fs/promises';
import { report, seed, today } from '../public/domain.js';
const input=process.argv[2];
if(!input){console.error('Käyttö: npm run report -- <viety-json-tiedosto|--demo> [YYYY-MM-DD]');process.exit(1);}
try{
  const state=input==='--demo'?seed():JSON.parse(await readFile(input,'utf8'));
  if(state.version!==1||!Array.isArray(state.people)||!Array.isArray(state.needs)||!Array.isArray(state.availability))throw new Error('Tuntematon tiedostomuoto.');
  console.log(report(state,process.argv[3]||today()));
}catch(error){console.error('Raportti epäonnistui: '+error.message);process.exitCode=1;}
