import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAutonomousPaperMonitor} from '../learning/src/autonomousPaperMonitor.js';
import {createFinalCommissioningStore,buildCommissioningStatus} from '../backend/src/finalCommissioning.js';
import {analyzeCommissioningSoak,analyzeCommissioningMisses} from '../backend/src/analyzeCommissioningMisses.js';
import {runPaperMonitorCycle} from '../backend/src/paperMonitorCycle.js';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'will-p0c-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const filePath=path.join(root,'monitor.json');const ledger=createFinalCommissioningStore({filePath:path.join(root,'commissioning.json'),history:[],now:()=> '2026-10-01T00:00:00.000Z'});
  return {root,filePath,ledger};}
const status=(ledger,monitor)=>buildCommissioningStatus({ledger,monitor:monitor.health()});

test('failed cadences survive restart and later success preserves exact accounting',async t=>{
  const {filePath,ledger}=fixture(t);let at=120_000;
  const outcomes=[{ok:false,status:'REQUEST_TIMEOUT'},{ok:false,status:'NETWORK_FAILURE'},
    {ok:false,status:'HTTP_FAILURE'},{ok:false,status:'PROVIDER_UNAVAILABLE'},
    {ok:true,reasonSummary:{recordCount:0,zeroRecord:true,reasons:{NO_SIGNAL:1}}}];
  const monitor=createAutonomousPaperMonitor({enabled:true,filePath,captureCycleSummary:true,now:()=>at,
    runCycle:async()=>outcomes.shift()});
  for(let n=0;n<5;n++,at+=60_000)await monitor.runOnce();
  let report=status(ledger,monitor);
  assert.equal(report.monitorCompletedCycles,5);assert.equal(report.summaryCoverageCycles,5);
  assert.equal(report.successfulObservationCycles,1);assert.equal(report.operationalFailureCycles,4);
  assert.equal(report.nonObservationTerminalCycles,0);assert.equal(report.unclassifiedCompletedCycles,0);
  assert.deepEqual(report.operationalFailuresByReason,{REQUEST_TIMEOUT:1,NETWORK_FAILURE:1,HTTP_FAILURE:1,PROVIDER_UNAVAILABLE:1});
  assert.equal(report.lastSuccessfulCompleteCycle,'autonomous-paper-monitor-v1:6');
  const saved=fs.readFileSync(filePath,'utf8');assert.doesNotMatch(saved,/secret|stack|https?:\/\/|api_key/i);
  const restarted=createAutonomousPaperMonitor({enabled:true,filePath,captureCycleSummary:true,now:()=>at,
    runCycle:async()=>{throw Error('unexpected');}});
  report=status(ledger,restarted);assert.equal(report.operationalFailureCycles,4);
  assert.equal(report.monitorCompletedCycles,report.successfulObservationCycles+report.operationalFailureCycles+
    report.nonObservationTerminalCycles+report.unclassifiedCompletedCycles);
});

test('evidence operational terminal has a durable failure summary before seal',async t=>{
  const {filePath,ledger}=fixture(t);let paused=false;
  const evidence={recover:()=>({sealedCycleIds:[]}),health:()=>({paused,collectionClosed:false,observationTerminalRequired:true}),
    openMonitorCycle(){},issueRequestCapability:()=> 'a'.repeat(64),commitObservationTerminal(_id,terminal){
      assert.deepEqual(terminal,{outcome:'OPERATIONAL_FAILURE',reasonCode:'REQUEST_TIMEOUT'});},
    sealMonitorCycle(id){const saved=JSON.parse(fs.readFileSync(filePath,'utf8'));
      assert.equal(saved.cycleSummaries[id].terminalStatus,'OBSERVATION_OPERATIONAL_FAILURE');
      assert.deepEqual(saved.completedCycleIds,[]);},pause(){paused=true;}};
  const monitor=createAutonomousPaperMonitor({enabled:true,filePath,captureCycleSummary:true,cycleEvidence:evidence,
    now:()=>120_000,runCycle:async()=>({ok:false,status:'REQUEST_TIMEOUT'})});
  assert.equal((await monitor.runOnce()).status,'OBSERVATION_OPERATIONAL_FAILURE');
  assert.equal(status(ledger,monitor).operationalFailureCycles,1);
});

test('thrown network/provider errors persist category only, not raw error',async t=>{
  const {filePath,ledger}=fixture(t);let at=120_000;
  const failures=[Object.assign(Error('https://host/?api_key=secret'),{cause:{code:'ECONNRESET'}}),
    Object.assign(Error('token=secret'),{status:503})];
  const monitor=createAutonomousPaperMonitor({enabled:true,filePath,captureCycleSummary:true,now:()=>at,
    runCycle:async()=>{throw failures.shift();}});
  await monitor.runOnce();at+=60_000;await monitor.runOnce();
  assert.deepEqual(status(ledger,monitor).operationalFailuresByReason,{NETWORK_FAILURE:1,HTTP_FAILURE:1});
  assert.doesNotMatch(fs.readFileSync(filePath,'utf8'),/secret|host|ECONNRESET|503/);
});

test('legacy state is readable and unknown historical cadences are not fabricated',t=>{
  const {filePath,ledger}=fixture(t);
  fs.writeFileSync(filePath,JSON.stringify({completedCycleIds:['autonomous-paper-monitor-v1:1','autonomous-paper-monitor-v1:2'],
    cycleSummaries:{'autonomous-paper-monitor-v1:1':{zeroRecord:true,reasons:{NO_SIGNAL:1}}}}));
  const monitor=createAutonomousPaperMonitor({enabled:true,filePath,captureCycleSummary:true,runCycle:async()=>({ok:true})});
  const report=status(ledger,monitor);assert.equal(report.monitorCompletedCycles,2);
  assert.equal(report.successfulObservationCycles,1);assert.equal(report.unclassifiedCompletedCycles,1);
  assert.equal(report.operationalFailureCycles,0);
});

test('Coinbase state is authoritative even when ready is true',t=>{
  const {ledger}=fixture(t);
  for(const [state,connected] of [['CONNECTED',true],['RECONNECTING',false],['ERROR',false],['DISABLED',false]]){
    const report=buildCommissioningStatus({ledger,providers:{coinbase:{'BTC/USD':{enabled:true,running:true,ready:true,state,connected:true}}}});
    assert.equal(report.providerStatus.coinbase['BTC/USD'].connected,connected);
  }
});

test('failed internal HTTP response has sanitized HTTP category without body text',async()=>{
  const result=await runPaperMonitorCycle({baseUrl:'http://127.0.0.1:3000',cycleId:'autonomous-paper-monitor-v1:1',
    multiAsset:true,timeout:{valid:true,timeoutMs:1000},fetchImpl:async()=>({ok:false,json:async()=>({error:'secret provider text'})})});
  assert.equal(result.status,'HTTP_FAILURE');assert.doesNotMatch(JSON.stringify(result),/secret provider text/);
  const malformed=await runPaperMonitorCycle({baseUrl:'http://127.0.0.1:3000',cycleId:'autonomous-paper-monitor-v1:1',
    multiAsset:true,timeout:{valid:true,timeoutMs:1000},fetchImpl:async()=>({ok:false,json:async()=>{throw Error('raw secret body');}})});
  assert.equal(malformed.status,'HTTP_FAILURE');assert.doesNotMatch(JSON.stringify(malformed),/raw secret body/);
});

test('read-only analyzer reports misses and aggregates without performance or mutation',t=>{
  const {root}=fixture(t),id='fixture-id',cycle='autonomous-paper-monitor-v1:2';
  const state={schemaVersion:'paper-final-commissioning-v1',entries:{[id]:{
    monitorCycleId:cycle,asset:'EUR/USD',direction:'BUY',providerSource:'twelvedata-closed-ohlc+biquote-forex-tick',
    plannedClickTime:'2026-10-01T12:00:00.000Z',entryReferenceMissReason:'PAPER_ENTRY_REFERENCE_WINDOW_MISSED',
    initialQuoteAgeMs:1200,providerHealthAtDecision:'BIQUOTE_TEMPORAL+TWELVE_CLOSED_OHLC'}}};
  const history=[{id,execution:{status:'PENDING_CONFIRMATION'}}];
  const stateFile=path.join(root,'commissioning-state.json'),historyFile=path.join(root,'will-history-soak.json');
  fs.writeFileSync(stateFile,JSON.stringify(state));fs.writeFileSync(historyFile,JSON.stringify(history));
  const before=[fs.readFileSync(stateFile),fs.readFileSync(historyFile)];
  const report=analyzeCommissioningSoak(root);
  assert.equal(report.missCount,1);assert.equal(report.byUtcHour['2026-10-01T12'],1);
  assert.equal(report.misses[0].providerObservationBeforeWindow,'UNKNOWN');
  assert.equal(report.misses[0].providerReadyAtMiss,'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(report),/"(?:WIN|LOSS|TIE|winRate|outcome|score|price|secret)"/i);
  assert.deepEqual(fs.readFileSync(stateFile),before[0]);assert.deepEqual(fs.readFileSync(historyFile),before[1]);
});

test('neighboring observations are positive evidence only; absence remains UNKNOWN',()=>{
  const provider='twelvedata-closed-ohlc+biquote-forex-tick';
  const entries={miss:{asset:'EUR/USD',providerSource:provider,plannedClickTime:'2026-10-01T12:00:00Z',
    entryReferenceMissReason:'PAPER_ENTRY_REFERENCE_WINDOW_MISSED'},
    before:{asset:'EUR/USD',providerSource:provider},after:{asset:'EUR/USD',providerSource:provider}};
  const history=[{id:'miss'},{id:'before',execution:{status:'PAPER_CONFIRMED',paperOnly:true,actualClickTime:'2026-10-01T11:59:59Z'}},
    {id:'after',execution:{status:'PAPER_CONFIRMED',paperOnly:true,actualClickTime:'2026-10-01T12:00:31Z'}}];
  const result=analyzeCommissioningMisses({state:{schemaVersion:'paper-final-commissioning-v1',entries},history});
  assert.equal(result.misses[0].providerObservationBeforeWindow,'OBSERVED');
  assert.equal(result.misses[0].providerObservationAfterWindow,'OBSERVED');
});
