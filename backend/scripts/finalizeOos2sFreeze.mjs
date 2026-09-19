import fs from 'node:fs';import path from 'node:path';import { execFileSync } from 'node:child_process';import { fileURLToPath } from 'node:url';
import { sha256,baselineCommitment,replayEvidence } from '../src/oos2rEvidence.js';

export const EXPECTED_HISTORY_SHA='4205d3e27ec6e374c3a3a746f19e9f85edd4b83772c3cb3bda35d8985f06d6ca';
export const EXPECTED_OOS2R_JOURNAL_SHA='7fd67906684c7be6ff2f9f7c5147992dc05ecff3cac9270e5895fa769d916b1f';
export function assertOos2rJournalHash(bytes) {if(sha256(bytes)!==EXPECTED_OOS2R_JOURNAL_SHA)throw new Error('OOS2S_OOS2R_JOURNAL_SHA_MISMATCH');return true;}
export function validateOos2rSnapshot(entries) {
  if(entries.length!==23||entries.some(e=>!e.projectionValid||e.manifest.state!=='SEALED')||entries.reduce((n,e)=>n+e.manifest.expectedRecordCount,0)!==12)throw new Error('OOS2S_OOS2R_SNAPSHOT_MISMATCH');
  return true;
}
export function finalizeOos2sFreeze({historyFile,oos2rEvidenceDirectory,edgeCut,write=false,confirmBackendStopped=false,freezeFile,sourceHead}={}) {
  if(!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(edgeCut??'')||!Number.isFinite(Date.parse(edgeCut)))throw new Error('OOS2S_EXPLICIT_EDGE_CUT_REQUIRED');
  if(write&&!confirmBackendStopped)throw new Error('OOS2S_BACKEND_STOP_CONFIRMATION_REQUIRED');
  const historyBytes=fs.readFileSync(historyFile);if(sha256(historyBytes)!==EXPECTED_HISTORY_SHA)throw new Error('OOS2S_HISTORY_SHA_MISMATCH');
  const history=JSON.parse(historyBytes.toString('utf8').replace(/^\uFEFF/,''));if(history.length!==1108)throw new Error('OOS2S_HISTORY_COUNT_MISMATCH');
  const commitment=baselineCommitment(history),journalFile=path.join(oos2rEvidenceDirectory,'journal.jsonl'),journalBytes=fs.readFileSync(journalFile);
  assertOos2rJournalHash(journalBytes);
  const manifests=fs.readdirSync(oos2rEvidenceDirectory).filter(x=>x.endsWith('.manifest.json')).map(x=>JSON.parse(fs.readFileSync(path.join(oos2rEvidenceDirectory,x),'utf8'))),entries=replayEvidence(journalBytes,manifests);
  validateOos2rSnapshot(entries);
  const head=sourceHead??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const freeze={schemaVersion:'edge-gate-oos2s-freeze-v1',policy:'IMMUTABLE_AFTER_FREEZE',experiment:'WILL Edge Gate OOS-2S',protocolId:'will-edge-gate-oos2s-v1',campaignId:'will-edge-gate-oos2s-20260919-v1',edgeCut,createdAt:edgeCut,sourceHead:head,mode:'PAPER_READ_ONLY',frozenThreshold:0.599936,operator:'<=',metric:'MeanAbsMomentum',rawQ50:0.599936477924654,
    formula:{field:'metadata.featureSnapshot.momentum',transform:'abs',aggregation:'arithmetic mean by cycle',population:'official PAPER_CONFIRMED WIN/LOSS/TIE only'},baselineCount:commitment.baselineCount,baselineIdsSha256:commitment.baselineIdsSha256,historyFileSha256:EXPECTED_HISTORY_SHA,
    terminal:{trade:'CLOSED WIN/LOSS/TIE/DATA_INVALID with valid post-open settledAt; W/L/T require frozen settlement provenance',noTrade:'unchanged WAL-born SKIPPED with null execution/outcome/settledAt/clickTime'},checkpoint:{candidateCycles:50,selection:'first 50 matching WAL OPENs ordered by openedAt then cycleId',invalidAndIncompleteSlots:'retained; no replacements'},bootstrap:{unit:'cycle',replications:10000,seed:20260915,rng:'xorshift32'},
    performance:{primary:'accepted-cycle official WIN/LOSS/TIE only',noTrade:'excluded',dataInvalid:'reported separately and excluded',expectancy:'NOT_AVAILABLE',financialEdge:'NOT_AVAILABLE',subgroups:'EXPLORATORY_ONLY'},
    retirementProvenanceOos2r:{classification:'OPERATOR_CAPTURED_PROVENANCE',reason:'PROTOCOL_COMPLETENESS_DEFECT_SKIPPED_NONTERMINAL',historyCount:1108,historyFileSha256:EXPECTED_HISTORY_SHA,oos2rJournalSha256:EXPECTED_OOS2R_JOURNAL_SHA,cycles:23,sealed:23,invalid:0,open:0,inventoryRecords:12},noRetuning:true,noEarlyStopping:true,noAutomaticLivePromotion:true,activationAuthorized:false};
  const bytes=Buffer.from(`${JSON.stringify(freeze,null,2)}\n`,'utf8'),freezeSha256=sha256(bytes),report={mode:write?'WRITE':'DRY_RUN',...commitment,historyFileSha256:EXPECTED_HISTORY_SHA,oos2rJournalSha256:EXPECTED_OOS2R_JOURNAL_SHA,cycles:23,freezeSha256,edgeCut,freeze};
  if(write){if(!freezeFile)throw new Error('OOS2S_FREEZE_FILE_REQUIRED');const sidecar=`${freezeFile}.sha256`;if(fs.existsSync(freezeFile)||fs.existsSync(sidecar))throw new Error('OOS2S_FREEZE_ALREADY_EXISTS');fs.mkdirSync(path.dirname(freezeFile),{recursive:true});fs.writeFileSync(freezeFile,bytes,{flag:'wx'});fs.writeFileSync(sidecar,`${freezeSha256}\n`,{flag:'wx'});}
  return report;
}
function arg(name){const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const backend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const report=finalizeOos2sFreeze({historyFile:arg('--history')??path.join(backend,'data','will-history.json'),oos2rEvidenceDirectory:arg('--oos2r-evidence')??path.join(backend,'data','oos2r-evidence-20260918-v1'),edgeCut:arg('--edge-cut'),write:process.argv.includes('--write'),confirmBackendStopped:process.argv.includes('--confirm-backend-stopped'),freezeFile:arg('--freeze')??path.join(backend,'config','experiments','edge-gate-oos2s-freeze.json')});console.log(JSON.stringify(report,null,2));}
  catch(error){console.error(JSON.stringify({ok:false,error:String(error?.message||'OOS2S_FINALIZATION_FAILED')}));process.exitCode=1;}
}
