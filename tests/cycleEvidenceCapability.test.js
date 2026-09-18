import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCycleEvidenceRuntime } from '../learning/src/cycleEvidenceRuntime.js';
import { createHistoryStore } from '../learning/src/historyStore.js';
import { createAutonomousPaperMonitor } from '../learning/src/autonomousPaperMonitor.js';
import { withCycleEvidenceRequest } from '../backend/src/cycleEvidenceRequest.js';
import { runPaperMonitorCycle } from '../backend/src/paperMonitorCycle.js';

const cycleId='autonomous-paper-monitor-v1:1', header='x-will-cycle-evidence-capability',at='2026-09-18T00:00:00.000Z';
function setup(t) {
  const directory=fs.mkdtempSync(path.join(tmpdir(),'will-capability-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=createHistoryStore();let clock=0;
  const controller=createCycleEvidenceRuntime({directory,protocolId:'synthetic-protocol',campaignId:'synthetic-campaign',historyStore:store,now:()=>at,capabilityNow:()=>clock});
  controller.recover();controller.openMonitorCycle(cycleId);
  return {directory,store,controller,advance:value=>{clock=value;}};
}
async function request(controller, token, id=cycleId) {
  const req={query:{monitorCycleId:id,protocolId:'forged',campaignId:'forged',writerGeneration:'999'},
    headers:token===undefined?{}:{[header]:token},rawHeaders:token===undefined?[]:[header,token],app:{locals:{cycleEvidenceRuntime:controller}}};
  const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await withCycleEvidenceRequest(async(r,s)=>{
    const record=r.cycleEvidenceRecord({decision:{direction:'WAIT'},context:{monitorCycleId:id}});
    return s.json({ok:true,record,headers:r.headers,rawHeaders:r.rawHeaders});
  })(req,res);
  return res;
}
test('correct capability admits exactly one official writer, strips header and cannot replay',async t=>{
  const s=setup(t), token=s.controller.issueRequestCapability(cycleId);
  assert.match(token,/^[a-f0-9]{64}$/);
  const res=await request(s.controller,token);
  assert.equal(res.code,200);assert.equal(res.body.record.protocolId,'synthetic-protocol');
  assert.equal(res.body.record.campaignId,'synthetic-campaign');assert.equal(res.body.record.writerGeneration,1);
  assert.deepEqual(res.body.headers,{});assert.deepEqual(res.body.rawHeaders,[]);
  assert.equal((await request(s.controller,token)).code,403);assert.equal(s.store.list().length,1);
});
for(const kind of ['missing','wrong','other-cycle','expired','clock-regression']) {
  test(`${kind} capability blocks predictable cycle/query forgery without record creation`,async t=>{
    const s=setup(t);let token=s.controller.issueRequestCapability(cycleId),id=cycleId;
    if(kind==='missing')token=undefined;
    if(kind==='wrong')token='a'.repeat(64);
    if(kind==='other-cycle'){id='autonomous-paper-monitor-v1:2';s.controller.openMonitorCycle(id);}
    if(kind==='expired')s.advance(30000);
    if(kind==='clock-regression')s.advance(-1);
    const res=await request(s.controller,token,id);
    assert.equal(res.code,403);assert.equal(s.store.list().length,0);
    assert.doesNotMatch(JSON.stringify(res.body),/campaignId|protocolId|writerGeneration|forged/);
  });
}
for(const action of ['seal','invalidate','pause']) {
  test(`capability revoked after ${action}`,async t=>{
    const s=setup(t), token=s.controller.issueRequestCapability(cycleId);
    if(action==='seal')s.controller.sealMonitorCycle(cycleId);
    if(action==='invalidate')s.controller.invalidateMonitorCycle(cycleId);
    if(action==='pause')s.controller.pause();
    const res=await request(s.controller,token);
    assert.equal(res.code,action==='pause'?503:403);assert.equal(s.store.list().length,0);
  });
}
test('token absent from response, history, WAL, manifest and logs',async t=>{
  const s=setup(t),token=s.controller.issueRequestCapability(cycleId),logs=[];
  const originals={log:console.log,warn:console.warn,error:console.error};
  let res;
  try {
    for(const key of Object.keys(originals))console[key]=(...args)=>logs.push(args.map(String).join(' '));
    res=await request(s.controller,token);s.controller.sealMonitorCycle(cycleId);
  } finally { Object.assign(console,originals); }
  const persisted=fs.readdirSync(s.directory).map(name=>fs.readFileSync(path.join(s.directory,name),'utf8')).join('\n');
  for(const text of [JSON.stringify(res.body),JSON.stringify(s.store.list()),persisted,JSON.stringify(logs)]) assert.equal(text.includes(token),false);
});
test('monitor issues capability after open and transports it only in internal opportunities header',async t=>{
  const directory=fs.mkdtempSync(path.join(tmpdir(),'will-capability-monitor-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=createHistoryStore(), controller=createCycleEvidenceRuntime({directory:path.join(directory,'wal'),protocolId:'synthetic-protocol',campaignId:'synthetic-campaign',historyStore:store,now:()=>at});
  let capability;const seen=[];
  const monitor=createAutonomousPaperMonitor({enabled:true,now:()=>Date.parse(at),filePath:path.join(directory,'monitor.json'),cycleEvidence:controller,
    runCycle:async args=>{
      capability=args.capability;assert.match(capability,/^[a-f0-9]{64}$/);
      return runPaperMonitorCycle({baseUrl:'http://127.0.0.1:3000',cycleId:args.cycleId,capability,timeout:{valid:true,timeoutMs:1000},
        fetchImpl:async(url,options)=>{
          seen.push({url:String(url),options});
          if(url.pathname.includes('diagnostic'))return {ok:true,json:async()=>({diagnostic:{status:'HEALTHY'}})};
          assert.equal(controller.consumeRequestCapability(args.cycleId,options.headers['X-WILL-CYCLE-EVIDENCE-CAPABILITY']),true);
          return {ok:true,json:async()=>({ok:true,scanned:0})};
        }});
    }});
  assert.equal((await monitor.runOnce()).status,'COMPLETED');
  assert.equal(seen.length,2);assert.equal(seen[0].options.headers,undefined);
  assert.equal(seen[1].options.headers['X-WILL-CYCLE-EVIDENCE-CAPABILITY'],capability);
  assert.equal(seen[1].options.redirect,'error');
  assert.ok(seen.every(r=>!r.url.includes(capability)));assert.equal(JSON.stringify(monitor.health()).includes(capability),false);
  assert.equal(fs.readFileSync(path.join(directory,'monitor.json'),'utf8').includes(capability),false);
});
test('capability cannot be sent to external host and legacy path remains header-free',async()=>{
  let calls=0;
  const result=await runPaperMonitorCycle({baseUrl:'https://example.com',cycleId,capability:'a'.repeat(64),timeout:{valid:true,timeoutMs:1000},fetchImpl:async()=>{calls++;}});
  assert.equal(result.status,'EVIDENCE_TARGET_INVALID');assert.equal(calls,0);
  await runPaperMonitorCycle({baseUrl:'http://127.0.0.1:3000',cycleId,multiAsset:true,timeout:{valid:true,timeoutMs:1000},fetchImpl:async(url,options)=>{
    assert.equal(options.headers,undefined);return {ok:true,json:async()=>({ok:true})};}});
});
test('disabled evidence does not require or consume capability',async()=>{
  let called=0;const res={json:()=>{called++;}};
  await withCycleEvidenceRequest(async(req,r)=>{assert.equal(req.cycleEvidenceRecord,undefined);r.json({ok:true});})({query:{monitorCycleId:cycleId},app:{locals:{}}},res);
  assert.equal(called,1);
});
