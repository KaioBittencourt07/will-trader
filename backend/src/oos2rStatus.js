import fs from 'node:fs';
import path from 'node:path';
import { replayEvidence } from './oos2rEvidence.js';
import { readOos2rFreeze } from './evaluateOos2r.js';
import { OOS2R_PROTOCOL, OOS2R_CAMPAIGN } from './oos2rActivation.js';

const REQUIRED_CYCLES=50;

function readProjections(directory) {
  return fs.readdirSync(directory,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&entry.name.endsWith('.manifest.json'))
    .map(entry=>JSON.parse(fs.readFileSync(path.join(directory,entry.name),'utf8')));
}

export function inspectOos2rCollectionStatus({
  evidenceDirectory,
  freezeFile,
  readFreeze=readOos2rFreeze
}={}) {
  const freeze=readFreeze(freezeFile);

  const base={
    schemaVersion:'will-oos2r-collection-status-v1',
    protocolId:OOS2R_PROTOCOL,
    campaignId:OOS2R_CAMPAIGN,
    edgeCut:freeze.edgeCut,
    requiredCycles:REQUIRED_CYCLES,
    readOnly:true
  };

  if(
    freeze.protocolId!==OOS2R_PROTOCOL||
    freeze.campaignId!==OOS2R_CAMPAIGN
  ) {
    return Object.freeze({
      ...base,
      ok:false,
      state:'OOS2R_FAIL_CLOSED',
      error:'OOS2R_FROZEN_IDENTITY_INVALID'
    });
  }

  if(!evidenceDirectory||!path.isAbsolute(evidenceDirectory)) {
    return Object.freeze({
      ...base,
      ok:false,
      state:'OOS2R_FAIL_CLOSED',
      error:'OOS2R_EVIDENCE_DIRECTORY_REQUIRED'
    });
  }

  if(!fs.existsSync(evidenceDirectory)) {
    return Object.freeze({
      ...base,
      ok:true,
      state:'OOS2R_NOT_STARTED',
      observedCycles:0,
      sealedCycles:0,
      invalidCycles:0,
      openCycles:0,
      firstCycleConfirmed:false,
      formalAnalysisAllowed:false
    });
  }

  try {
    const journalFile=path.join(evidenceDirectory,'journal.jsonl');

    if(!fs.existsSync(journalFile)) {
      return Object.freeze({
        ...base,
        ok:true,
        state:'OOS2R_RESERVED_NOT_OPENED',
        observedCycles:0,
        sealedCycles:0,
        invalidCycles:0,
        openCycles:0,
        firstCycleConfirmed:false,
        formalAnalysisAllowed:false
      });
    }

    const wal=fs.readFileSync(journalFile);
    const projections=readProjections(evidenceDirectory);
    const replayed=replayEvidence(wal,projections);

    for(const {manifest} of replayed) {
      if(
        manifest.protocolId!==OOS2R_PROTOCOL||
        manifest.campaignId!==OOS2R_CAMPAIGN
      ) {
        throw new Error('OOS2R_EVIDENCE_IDENTITY_MISMATCH');
      }

      const openedAt=Date.parse(manifest.openedAt);
      if(!Number.isFinite(openedAt)||openedAt<=Date.parse(freeze.edgeCut)) {
        throw new Error('OOS2R_TEMPORAL_MEMBERSHIP_INVALID');
      }
    }

    const matching=replayed
      .sort((a,b)=>
        Date.parse(a.manifest.openedAt)-Date.parse(b.manifest.openedAt)||
        a.manifest.cycleId.localeCompare(b.manifest.cycleId)
      );

    const first50=matching.slice(0,REQUIRED_CYCLES);
    const sealedCycles=first50.filter(x=>x.manifest.state==='SEALED').length;
    const invalidCycles=first50.filter(x=>x.manifest.state==='INVALID').length;
    const openCycles=first50.filter(x=>x.manifest.state==='OPEN').length;

    return Object.freeze({
      ...base,
      ok:true,
      state:matching.length
        ? 'OOS2R_COLLECTION_ACTIVE'
        : 'OOS2R_RESERVED_NOT_OPENED',
      observedCycles:first50.length,
      sealedCycles,
      invalidCycles,
      openCycles,
      firstCycleConfirmed:first50.length>0,
      formalAnalysisAllowed:false
    });
  } catch(error) {
    return Object.freeze({
      ...base,
      ok:false,
      state:'OOS2R_FAIL_CLOSED',
      error:String(error?.message||'OOS2R_EVIDENCE_INVALID').slice(0,180),
      formalAnalysisAllowed:false
    });
  }
}
