import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createFinalCommissioningStore, buildCommissioningStatus, classifyCycleReason, summarizeOpportunityCycle } from '../backend/src/finalCommissioning.js';
import { createAutonomousPaperMonitor } from '../learning/src/autonomousPaperMonitor.js';
import { runPaperMonitorCycle } from '../backend/src/paperMonitorCycle.js';

const start='2026-10-01T00:00:00.000Z',planned='2026-10-02T00:00:00.000Z';
function dir(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'will-h1-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function record(id='p1',changes={}){return {id,decisionId:`autonomous-paper-monitor-v1:1:EUR/USD:${crypto.createHash('sha256').update(id).digest('hex').slice(0,12)}`,createdAt:'2026-10-02T00:00:00.000Z',
  asset:'EUR/USD',direction:'BUY',status:'OPEN',clickTime:planned,outcome:null,
  execution:{status:'PENDING_CONFIRMATION',plannedClickTime:planned,actualClickTime:null,paperOnly:false},
  metadata:{context:{monitorCycleId:'autonomous-paper-monitor-v1:1',expirySeconds:60,providerHealth:'HEALTHY'},
    dataQuality:{source:'fixture-forex',ageMs:1000}},...changes};}
function store(t,history=[]){return createFinalCommissioningStore({filePath:path.join(dir(t),'commissioning.json'),history,now:()=>start});}
function status(ledger,monitor={cycleSummaries:{},last:null}){return buildCommissioningStatus({ledger,monitor,providers:{fixture:{ready:true}}});}

test('provider unavailable has only a sanitized reason',()=>assert.equal(classifyCycleReason('PROVIDER_UNAVAILABLE: token=secret'),'PROVIDER_UNAVAILABLE'));
test('HTTP 429 and cooldown are provider cooldown',()=>{assert.equal(classifyCycleReason('HTTP 429'),'PROVIDER_COOLDOWN');assert.equal(classifyCycleReason('cooldown active'),'PROVIDER_COOLDOWN');});
test('stale quote is stale data',()=>assert.equal(classifyCycleReason('QUOTE_AGE_EXCEEDED'),'STALE_DATA'));
test('malformed provider payload is market data invalid',()=>assert.equal(classifyCycleReason('MALFORMED_OHLC'),'MARKET_DATA_INVALID'));
test('entry reference missing remains a terminal DATA_INVALID without fabricated timestamp',t=>{
  const s=store(t),r=record('entry',{status:'CLOSED',outcome:'DATA_INVALID',outcomeMetadata:{reason:'PAPER_ENTRY_REFERENCE_WINDOW_MISSED'}});
  s.observeHistory([r]);const e=s.snapshot().entries.entry;
  assert.equal(e.entryReferenceFound,false);assert.equal(e.firstValidTemporalReferenceTimestamp,null);
  assert.equal(e.entryReferenceMissReason,'PAPER_ENTRY_REFERENCE_WINDOW_MISSED');assert.equal(e.settlementFinalState,'DATA_INVALID');
});
test('expiry reference missing stays explicit and entry time is retained',t=>{
  const s=store(t),r=record('exit',{status:'CLOSED',outcome:'DATA_INVALID',
    execution:{status:'PAPER_CONFIRMED',paperOnly:true,plannedClickTime:planned,actualClickTime:'2026-10-02T00:00:01.000Z'},
    outcomeMetadata:{reason:'PAPER_EXIT_REFERENCE_WINDOW_MISSED'}});
  s.observeHistory([r]);const e=s.snapshot().entries.exit;
  assert.equal(e.entryReferenceLagMs,1000);assert.equal(e.expiryReferenceFound,false);
  assert.equal(e.settlementMissReason,'PAPER_EXIT_REFERENCE_WINDOW_MISSED');
});
test('feed disconnect is provider unavailable',()=>assert.equal(classifyCycleReason('WEBSOCKET_DISCONNECT'),'PROVIDER_UNAVAILABLE'));
test('settlement lag remains pending, not a fabricated miss',t=>{const s=store(t);s.observeHistory([record()]);const result=status(s);assert.equal(result.temporalEntryCoverage.pending,1);assert.equal(result.referenceWindowMisses.PAPER_ENTRY_REFERENCE_WINDOW_MISSED,undefined);});
test('configured telemetry does not claim an active soak while monitor is disabled',t=>{
  const s=store(t);assert.equal(buildCommissioningStatus({ledger:s,monitor:{enabled:false}}).state,'INACTIVE');
});
test('AI unavailable cannot become a trade or free-text diagnostic',()=>assert.equal(classifyCycleReason('AI unavailable; api_key=secret'),'OTHER_SANITIZED_REASON'));
test('zero-record successful cycle carries durable safe reason summary',async t=>{
  const root=dir(t),filePath=path.join(root,'monitor.json');
  const monitor=createAutonomousPaperMonitor({enabled:true,filePath,captureCycleSummary:true,now:()=>120000,
    runCycle:async()=>({ok:true,reasonSummary:summarizeOpportunityCycle({scanned:0,unavailable:[{error:'HTTP 429 key=secret'}]})})});
  const event=await monitor.runOnce();assert.equal(event.status,'COMPLETED');
  const saved=JSON.parse(fs.readFileSync(filePath,'utf8'));
  assert.equal(saved.cycleSummaries[event.cycleId].zeroRecord,true);
  assert.equal(saved.cycleSummaries[event.cycleId].reasons.PROVIDER_COOLDOWN,1);
  assert.doesNotMatch(JSON.stringify(saved),/key=secret/);
});
test('evidence seal observes durable summary first and restart recovers it without fabrication',async t=>{
  const root=dir(t),filePath=path.join(root,'monitor.json');let sealed=false,paused=false;
  const evidence={recover:()=>({sealedCycleIds:sealed?['autonomous-paper-monitor-v1:2']:[]}),
    health:()=>({paused,collectionClosed:false,observationTerminalRequired:true}),
    openMonitorCycle(){},issueRequestCapability:()=> 'a'.repeat(64),commitObservationTerminal(){},
    sealMonitorCycle(){const saved=JSON.parse(fs.readFileSync(filePath,'utf8'));
      assert.equal(saved.cycleSummaries['autonomous-paper-monitor-v1:2'].reasons.NO_SIGNAL,1);
      assert.deepEqual(saved.completedCycleIds,[]);sealed=true;throw Error('SIMULATED_AFTER_SEAL_CRASH');},
    pause(){paused=true;}};
  const first=createAutonomousPaperMonitor({enabled:true,filePath,cycleEvidence:evidence,captureCycleSummary:true,
    now:()=>120000,runCycle:async()=>({ok:true,reasonSummary:{zeroRecord:true,recordCount:0,skippedCount:0,reasons:{NO_SIGNAL:1}}})});
  assert.equal((await first.runOnce()).status,'PAUSED');assert.deepEqual(first.health().cycleSummaries,{});
  paused=false;
  const recovered={...evidence,sealMonitorCycle(){throw Error('unexpected');}};
  const second=createAutonomousPaperMonitor({enabled:true,filePath,cycleEvidence:recovered,captureCycleSummary:true,
    now:()=>120000,runCycle:async()=>{throw Error('unexpected');}});
  assert.equal((await second.runOnce()).status,'IDEMPOTENT');
  assert.equal(second.health().cycleSummaries['autonomous-paper-monitor-v1:2'].reasons.NO_SIGNAL,1);
});
test('all-SKIPPED cycle is counted without exposing directions or outcomes',()=>{
  const summary=summarizeOpportunityCycle({scanned:2,candidates:[{stages:{releaseEligible:false},waitCode:'WAIT_STRATEGY'},
    {stages:{releaseEligible:false},waitCode:'WAIT_STRATEGY'}]});
  assert.equal(summary.skippedCount,2);assert.equal(summary.reasons.WAIT_DECISION,2);
  assert.equal(summary.skippedReasons.WAIT_DECISION,2);
});
test('status counts zero-record cycles once per reason and skips separately',t=>{
  const s=store(t),zero=summarizeOpportunityCycle({scanned:0,unavailable:[{error:'HTTP 429'},{error:'HTTP 429'}]});
  const skip=summarizeOpportunityCycle({scanned:2,candidates:[{stages:{releaseEligible:false},waitCode:'WAIT_STRATEGY'},
    {stages:{releaseEligible:false},waitCode:'WAIT_STRATEGY'}]});
  const out=status(s,{cycleSummaries:{'autonomous-paper-monitor-v1:1':zero,'autonomous-paper-monitor-v1:2':skip},last:{status:'COMPLETED'}});
  assert.equal(out.zeroRecordCyclesByReason.PROVIDER_COOLDOWN,1);
  assert.equal(out.rateLimitCooldowns,2);
  assert.equal(out.skippedRecordsByReason.WAIT_DECISION,2);
  assert.equal(out.skippedRecords,2);
});
test('process restart reconciles only post-activation PAPER history',t=>{
  const root=dir(t),filePath=path.join(root,'state.json'),baseline=record('old',{createdAt:'2026-09-01T00:00:00.000Z'});
  const first=createFinalCommissioningStore({filePath,history:[baseline],now:()=>start});first.observeHistory([baseline,record('new')]);
  const second=createFinalCommissioningStore({filePath,history:[baseline,record('new')],now:()=>start});
  second.observeHistory([baseline,record('new')]);assert.deepEqual(Object.keys(second.snapshot().entries),['new']);
});
test('duplicate cycle summary is idempotent and conflicting duplicate fails closed',t=>{
  const s=store(t),summary={zeroRecord:true,recordCount:0,skippedCount:0,reasons:{NO_SIGNAL:1}};
  s.observeCycle('autonomous-paper-monitor-v1:1',summary);s.observeCycle('autonomous-paper-monitor-v1:1',summary);
  assert.throws(()=>s.observeCycle('autonomous-paper-monitor-v1:1',{...summary,recordCount:1}),/DUPLICATE_CYCLE_CONFLICT/);
});
test('duplicate record or decision ID fails closed',t=>{
  const s=store(t);assert.throws(()=>s.observeHistory([record('x'),record('x')]),/DUPLICATE_RECORD/);
  assert.throws(()=>s.observeHistory([record('x'),record('y',{decisionId:record('x').decisionId})]),/DUPLICATE_DECISION/);
});
test('history/commissioning persistence is separate and malformed history fails closed',t=>{
  const s=store(t);assert.throws(()=>s.observeHistory('bad'),/HISTORY_INVALID/);assert.deepEqual(s.snapshot().entries,{});
});
test('monitor persistence failure does not mark a cycle complete',async t=>{
  const root=dir(t),filePath=path.join(root,'state.json');
  const monitor=createAutonomousPaperMonitor({enabled:true,filePath,now:()=>120000,runCycle:async()=>({ok:true})});
  fs.mkdirSync(`${filePath}.tmp`);const event=await monitor.runOnce();assert.equal(event.status,'PAUSED');
  assert.equal(monitor.health().completedCycles,0);
  assert.equal(fs.existsSync(filePath),false);
});
test('PAPER/LIVE isolation excludes manual CONFIRMED and baseline records',t=>{
  const old=record('old'),s=store(t,[old]);s.observeHistory([old,record('manual',{execution:{status:'CONFIRMED'}}),record('paper')]);
  assert.deepEqual(Object.keys(s.snapshot().entries),['paper']);assert.equal(status(s).automatedBrokerExecution,false);
});
test('new PAPER records with regressed time or false PAPER provenance fail closed',t=>{
  const s=store(t);
  assert.throws(()=>s.observeHistory([record('clock',{createdAt:'2026-09-01T00:00:00.000Z'})]),/TEMPORAL_IDENTITY_INVALID/);
  assert.throws(()=>s.observeHistory([record('fake',{execution:{status:'PAPER_CONFIRMED',paperOnly:false,
    plannedClickTime:planned,actualClickTime:'2026-10-02T00:00:01.000Z'}})]),/PAPER_PROVENANCE_INVALID/);
});
test('credentials and prices never enter status or commissioning projection',t=>{
  const s=store(t);s.observeHistory([record('safe',{entryPrice:1234,metadata:{context:{monitorCycleId:'autonomous-paper-monitor-v1:1',expirySeconds:60,providerHealth:'token=secret'},
    dataQuality:{source:'fixture',ageMs:100}}})]);
  const json=JSON.stringify(buildCommissioningStatus({ledger:s,providers:{twelveWebSocket:{enabled:true,url:'https://host?api_key=secret'}}}));
  assert.doesNotMatch(json,/secret|1234|api_key|access_token/i);
});
test('monitor request uses one bounded PAPER opportunity call without broker capability',async()=>{
  const calls=[];const result=await runPaperMonitorCycle({baseUrl:'http://127.0.0.1:3000',cycleId:'autonomous-paper-monitor-v1:1',
    multiAsset:true,captureCycleSummary:true,timeout:{valid:true,timeoutMs:1000},fetchImpl:async(url)=>{calls.push(String(url));return {ok:true,json:async()=>({ok:true,scanned:0,unavailable:[]})};}});
  assert.equal(calls.length,1);assert.equal(result.reasonSummary.reasons.NO_SIGNAL,1);
  assert.equal(result.execution,undefined);
});
