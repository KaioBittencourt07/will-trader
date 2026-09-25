import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFinalCommissioningStore, allowCommissioningSettlement } from '../backend/src/finalCommissioning.js';
import { settleDuePaperCampaignOutcomes } from '../backend/src/paperOutcomeSettlement.js';

const activation='2026-10-01T00:00:00.000Z';
const planned='2026-10-02T00:00:00.000Z';
const cycle='autonomous-paper-monitor-v1:30000000';
function paper(id,{createdAt='2026-09-30T00:00:00.000Z',status='PENDING_CONFIRMATION',protocolId=null}={}){
  return {id,createdAt,protocolId,asset:'EUR/USD',direction:'BUY',status:'OPEN',outcome:null,clickTime:planned,
    execution:{status,plannedClickTime:planned,actualClickTime:status==='PAPER_CONFIRMED'?'2026-10-02T00:00:01.000Z':null,
      actualEntryPrice:status==='PAPER_CONFIRMED'?1.1:null,paperOnly:status==='PAPER_CONFIRMED'},
    metadata:{context:{monitorCycleId:cycle,expirySeconds:60}}};
}
function scenario(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'will-h1-settle-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const oldPending=paper('old-pending'),oldConfirmed=paper('old-confirmed',{status:'PAPER_CONFIRMED'});
  const rows=[oldPending,oldConfirmed],before=structuredClone(rows);
  const filePath=path.join(directory,'commissioning.json');
  const commissioning=createFinalCommissioningStore({filePath,history:rows,now:()=>activation});
  const historyStore={list:()=>structuredClone(rows)};
  const mutations=[];
  const paperMutationPort={
    confirmPaperExecution(id,{referenceTimestamp,referencePrice}){
      const item=rows.find(r=>r.id===id);mutations.push(['confirm',id]);
      item.execution={...item.execution,status:'PAPER_CONFIRMED',actualClickTime:referenceTimestamp,
        actualEntryPrice:referencePrice,paperOnly:true};return structuredClone(item);
    },
    settlePaperOutcome(id,outcome,metadata){
      const item=rows.find(r=>r.id===id);mutations.push(['settle',id]);
      item.status='CLOSED';item.outcome=outcome;item.outcomeMetadata=metadata;return structuredClone(item);
    }
  };
  const biquoteForexFeed={referenceAtOrAfter:(_asset,target)=>{
    const ms=Number(target),entry=Date.parse(planned);
    if(ms===entry)return {provider:'fixture',timestamp:'2026-10-02T00:00:01.000Z',price:1.1,valid:true,status:'OK',lagMs:1000};
    if(ms===entry+61_000)return {provider:'fixture',timestamp:'2026-10-02T00:01:02.000Z',price:1.2,valid:true,status:'OK',lagMs:1000};
    return null;
  }};
  const settle=(store=commissioning,extraAdmission=()=>true)=>settleDuePaperCampaignOutcomes({historyStore,paperMutationPort,
    biquoteForexFeed,recordAdmission:record=>allowCommissioningSettlement(record,{commissioningStore:store,
      evidenceRuntime:{isPaperSettlementAllowed:extraAdmission}}),
    now:Date.parse('2026-10-02T00:01:10.000Z')});
  return {rows,before,mutations,filePath,commissioning,settle};
}

test('legacy-prefix settlement cannot mutate old baseline OPEN/PENDING or PAPER_CONFIRMED records',t=>{
  const s=scenario(t);const result=s.settle();
  assert.equal(result.settlementScope.mode,'LEGACY_MONITOR_PREFIX');
  assert.equal(result.openCampaignSignalsChecked,0);
  assert.deepEqual(s.rows,s.before);assert.deepEqual(s.mutations,[]);
});

test('new post-activation PAPER record settles normally while old baseline remains byte-identical',t=>{
  const s=scenario(t);s.rows.push(paper('new',{createdAt:'2026-10-02T00:00:00.000Z'}));
  const result=s.settle();
  assert.equal(result.openCampaignSignalsChecked,1);assert.equal(result.wins,1);
  assert.equal(s.rows[2].outcome,'WIN');assert.equal(s.rows[2].execution.status,'PAPER_CONFIRMED');
  assert.deepEqual(s.rows.slice(0,2),s.before);
  assert.deepEqual(s.mutations,[['confirm','new'],['settle','new']]);
});

test('restart retains exact baseline IDs and activation cut; equal-time and retired OOS are excluded',t=>{
  const s=scenario(t),restarted=createFinalCommissioningStore({filePath:s.filePath,history:s.rows,
    now:()=> '2026-10-03T00:00:00.000Z'});
  s.rows.push(paper('new',{createdAt:'2026-10-02T00:00:00.000Z'}));
  s.rows.push(paper('equal-cut',{createdAt:activation}));
  s.rows.push(paper('retired',{createdAt:'2026-10-02T00:00:00.000Z',protocolId:'will-edge-gate-oos2v-v1'}));
  assert.equal(restarted.admitsSettlement(s.rows[0]),false);
  assert.equal(restarted.admitsSettlement(s.rows[1]),false);
  assert.equal(restarted.admitsSettlement(s.rows[2]),true);
  assert.equal(restarted.admitsSettlement(s.rows[3]),false);
  assert.equal(restarted.admitsSettlement(s.rows[4]),false);
  const result=s.settle(restarted);
  assert.equal(result.openCampaignSignalsChecked,1);assert.equal(result.wins,1);
  assert.deepEqual(s.rows.slice(0,2),s.before);
  assert.equal(s.rows[3].status,'OPEN');assert.equal(s.rows[4].status,'OPEN');
});

test('commissioning admission AND evidence admission both must pass',t=>{
  const s=scenario(t);s.rows.push(paper('new',{createdAt:'2026-10-02T00:00:00.000Z'}));
  const denied=s.settle(s.commissioning,()=>false);
  assert.equal(denied.openCampaignSignalsChecked,0);assert.deepEqual(s.mutations,[]);
  const allowed=s.settle(s.commissioning,record=>record.id==='new');
  assert.equal(allowed.openCampaignSignalsChecked,1);assert.equal(allowed.wins,1);
});
