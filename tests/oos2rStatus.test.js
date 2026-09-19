import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCycleEvidenceJournal } from '../learning/src/cycleEvidenceJournal.js';
import { inspectOos2rCollectionStatus } from '../backend/src/oos2rStatus.js';
import { readOos2rFreeze } from '../backend/src/evaluateOos2r.js';
import { OOS2R_PROTOCOL,OOS2R_CAMPAIGN } from '../backend/src/oos2rActivation.js';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(tmpdir(),'will-oos2r-status-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));

  const evidenceDirectory=path.join(root,'evidence');
  const freeze=readOos2rFreeze();
  const readFreeze=()=>freeze;

  return {root,evidenceDirectory,freeze,readFreeze};
}

test('status is read-only NOT_STARTED when evidence directory is absent',t=>{
  const s=fixture(t);
  const before=fs.readdirSync(s.root);

  const result=inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:s.readFreeze
  });

  assert.equal(result.ok,true);
  assert.equal(result.state,'OOS2R_NOT_STARTED');
  assert.equal(result.observedCycles,0);
  assert.equal(result.firstCycleConfirmed,false);
  assert.equal(result.formalAnalysisAllowed,false);
  assert.equal(fs.existsSync(s.evidenceDirectory),false);
  assert.deepEqual(fs.readdirSync(s.root),before);
});

test('status reports reserved directory without creating WAL or projection',t=>{
  const s=fixture(t);
  fs.mkdirSync(s.evidenceDirectory);

  const before=fs.readdirSync(s.evidenceDirectory);

  const result=inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:s.readFreeze
  });

  assert.equal(result.ok,true);
  assert.equal(result.state,'OOS2R_RESERVED_NOT_OPENED');
  assert.equal(result.observedCycles,0);
  assert.equal(result.firstCycleConfirmed,false);
  assert.deepEqual(fs.readdirSync(s.evidenceDirectory),before);
  assert.equal(fs.existsSync(path.join(s.evidenceDirectory,'journal.jsonl')),false);
});

test('status fails closed for corrupt WAL and performs no repair',t=>{
  const s=fixture(t);
  fs.mkdirSync(s.evidenceDirectory);

  const journal=path.join(s.evidenceDirectory,'journal.jsonl');
  fs.writeFileSync(journal,'{corrupt}\n');

  const before=fs.readFileSync(journal);

  const result=inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:s.readFreeze
  });

  assert.equal(result.ok,false);
  assert.equal(result.state,'OOS2R_FAIL_CLOSED');
  assert.equal(result.formalAnalysisAllowed,false);
  assert.deepEqual(fs.readFileSync(journal),before);
});

test('status rejects frozen identity mismatch',t=>{
  const s=fixture(t);

  const result=inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:()=>({...s.freeze,protocolId:'wrong-protocol'})
  });

  assert.equal(result.ok,false);
  assert.equal(result.state,'OOS2R_FAIL_CLOSED');
  assert.equal(result.error,'OOS2R_FROZEN_IDENTITY_INVALID');
  assert.equal(fs.existsSync(s.evidenceDirectory),false);
});

test('status rejects missing or relative evidence path',t=>{
  const s=fixture(t);

  for(const evidenceDirectory of [undefined,'relative/evidence']) {
    const result=inspectOos2rCollectionStatus({
      evidenceDirectory,
      readFreeze:s.readFreeze
    });

    assert.equal(result.ok,false);
    assert.equal(result.state,'OOS2R_FAIL_CLOSED');
    assert.equal(result.error,'OOS2R_EVIDENCE_DIRECTORY_REQUIRED');
  }
});

test('authoritative synthetic OPEN becomes first observed OOS2R slot',t=>{
  const s=fixture(t);

  const journal=createCycleEvidenceJournal({
    directory:s.evidenceDirectory
  });

  const openedAt=new Date(Date.parse(s.freeze.edgeCut)+1).toISOString();

  journal.openCycle({
    protocolId:OOS2R_PROTOCOL,
    campaignId:OOS2R_CAMPAIGN,
    cycleId:'autonomous-paper-monitor-v1:synthetic-status-first',
    openedAt,
    history:[]
  });

  const result=inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:s.readFreeze
  });

  assert.equal(result.ok,true);
  assert.equal(result.state,'OOS2R_COLLECTION_ACTIVE');
  assert.equal(result.observedCycles,1);
  assert.equal(result.openCycles,1);
  assert.equal(result.sealedCycles,0);
  assert.equal(result.invalidCycles,0);
  assert.equal(result.firstCycleConfirmed,true);
  assert.equal(result.formalAnalysisAllowed,false);
});

test('status reader does not mutate authoritative OPEN evidence',t=>{
  const s=fixture(t);

  const journal=createCycleEvidenceJournal({
    directory:s.evidenceDirectory
  });

  journal.openCycle({
    protocolId:OOS2R_PROTOCOL,
    campaignId:OOS2R_CAMPAIGN,
    cycleId:'autonomous-paper-monitor-v1:synthetic-readonly',
    openedAt:new Date(Date.parse(s.freeze.edgeCut)+1).toISOString(),
    history:[]
  });

  const walFile=path.join(s.evidenceDirectory,'journal.jsonl');
  const beforeWal=fs.readFileSync(walFile);
  const beforeFiles=fs.readdirSync(s.evidenceDirectory).sort();

  inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:s.readFreeze
  });

  assert.deepEqual(fs.readFileSync(walFile),beforeWal);
  assert.deepEqual(fs.readdirSync(s.evidenceDirectory).sort(),beforeFiles);
});

test('valid WAL with wrong campaign identity fails closed instead of disappearing from progress',t=>{
  const s=fixture(t);

  const journal=createCycleEvidenceJournal({
    directory:s.evidenceDirectory
  });

  journal.openCycle({
    protocolId:OOS2R_PROTOCOL,
    campaignId:'wrong-campaign',
    cycleId:'autonomous-paper-monitor-v1:synthetic-wrong-campaign',
    openedAt:new Date(Date.parse(s.freeze.edgeCut)+1).toISOString(),
    history:[]
  });

  const result=inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:s.readFreeze
  });

  assert.equal(result.ok,false);
  assert.equal(result.state,'OOS2R_FAIL_CLOSED');
  assert.equal(result.error,'OOS2R_EVIDENCE_IDENTITY_MISMATCH');
  assert.equal(result.formalAnalysisAllowed,false);
});

test('valid WAL opened at edgeCut fails closed instead of disappearing from progress',t=>{
  const s=fixture(t);

  const journal=createCycleEvidenceJournal({
    directory:s.evidenceDirectory
  });

  journal.openCycle({
    protocolId:OOS2R_PROTOCOL,
    campaignId:OOS2R_CAMPAIGN,
    cycleId:'autonomous-paper-monitor-v1:synthetic-edgecut',
    openedAt:s.freeze.edgeCut,
    history:[]
  });

  const result=inspectOos2rCollectionStatus({
    evidenceDirectory:s.evidenceDirectory,
    readFreeze:s.readFreeze
  });

  assert.equal(result.ok,false);
  assert.equal(result.state,'OOS2R_FAIL_CLOSED');
  assert.equal(result.error,'OOS2R_TEMPORAL_MEMBERSHIP_INVALID');
  assert.equal(result.formalAnalysisAllowed,false);
});
