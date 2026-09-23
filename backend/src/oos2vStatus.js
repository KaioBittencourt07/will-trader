import fs from 'node:fs';
import path from 'node:path';
import {evaluateOos2v} from './evaluateOos2v.js';
import {isVerifiedOos2vFreeze} from './oos2vFreeze.js';

const safe=report=>({schemaVersion:'will-oos2v-status-v1',ok:true,status:report.status,
  candidateCyclesObserved:report.candidateCyclesObserved,candidateCycleLimit:50,collectionClosed:report.collectionClosed,
  newCandidateAdmissionAllowed:report.newCandidateAdmissionAllowed,sealedCandidateCycles:report.sealedCandidateCycles,
  invalidCandidateCycles:report.invalidCandidateCycles,openCandidateCycles:report.openCandidateCycles,
  completedCandidateCycles:report.completedCandidateCycles,incompleteCandidateCycles:report.incompleteCandidateCycles,
  recoveryInterruptedCycles:report.recoveryInterruptedCycles,replacement:'NONE',
  formalAnalysisAllowed:report.formalAnalysisAllowed,automatedBrokerExecution:false});
const failed=code=>({schemaVersion:'will-oos2v-status-v1',ok:false,status:'OOS2V_FAIL_CLOSED',error:code,
  formalAnalysisAllowed:false,automatedBrokerExecution:false});
export function inspectOos2vDirectoryStatus({evidenceDirectory,history=[],freeze}={}){
  if(!isVerifiedOos2vFreeze(freeze)||typeof evidenceDirectory!=='string'||!path.isAbsolute(evidenceDirectory))return failed('OOS2V_CONFIGURATION_UNAVAILABLE');
  if(!fs.existsSync(evidenceDirectory))return safe(evaluateOos2v({history,freeze}));
  try{
    if(fs.lstatSync(evidenceDirectory).isSymbolicLink())throw new Error('SYMLINK');
    const walBytes=fs.readFileSync(path.join(evidenceDirectory,'journal.jsonl'));
    const manifests=fs.readdirSync(evidenceDirectory).filter(name=>name.endsWith('.manifest.json'))
      .map(name=>JSON.parse(fs.readFileSync(path.join(evidenceDirectory,name),'utf8')));
    return safe(evaluateOos2v({history,walBytes,manifests,freeze}));
  }catch{return failed('OOS2V_EVIDENCE_INVALID');}
}
