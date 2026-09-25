import fs from 'node:fs';
import path from 'node:path';

export const PAPER_MONITOR_VERSION = 'autonomous-paper-monitor-v1';
const MIN_INTERVAL_MS = 60_000;
const MAX_ERROR_DETAIL_LENGTH = 240;
const SUMMARY_REASONS=new Set(['NO_SIGNAL','DEDUPLICATED','PROVIDER_UNAVAILABLE','PROVIDER_COOLDOWN','STALE_DATA',
  'MARKET_DATA_INVALID','ADMISSION_REJECTED','WAIT_DECISION','NO_EXECUTABLE_CANDIDATE','OTHER_SANITIZED_REASON']);
function sanitizeCycleSummary(value){
  if(!value||typeof value!=='object')return null;
  const number=x=>Number.isSafeInteger(x)&&x>=0?x:0;
  const reasons=x=>Object.fromEntries(Object.entries(x??{}).filter(([key,n])=>SUMMARY_REASONS.has(key)&&Number.isSafeInteger(n)&&n>=0));
  return {zeroRecord:value.zeroRecord===true,recordCount:number(value.recordCount),skippedCount:number(value.skippedCount),
    reasons:reasons(value.reasons),skippedReasons:reasons(value.skippedReasons),unavailableReasons:reasons(value.unavailableReasons)};
}

/**
 * Exposes enough local operational context to debug a failed cadence without
 * copying secrets, headers, credential-bearing URLs, or a stack trace into
 * durable monitor state or logs.
 */
export function sanitizeCycleError(error) {
  const status = Number(error?.status);
  const rawCode = String(error?.code ?? '').trim().toUpperCase();
  const errorCode = error?.name === 'TimeoutError' || /aborted due to timeout|request timeout/i.test(String(error?.message ?? '')) ? 'REQUEST_TIMEOUT'
    : /^E[A-Z0-9_]+$/.test(rawCode) ? `NETWORK_${rawCode}`
    : Number.isFinite(status) ? `HTTP_${status}`
      : 'CYCLE_ERROR';
  const message = String(error?.message ?? error ?? 'unknown cycle failure')
    .split(/\r?\n/, 1)[0]
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(bearer|token|api[_-]?key|apikey|secret|password)\b\s*(?:[:=]\s*|\s+)([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:api[_-]?key|apikey|token|authorization|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return Object.freeze({
    errorCode,
    errorDetail: (message || 'cycle failure').slice(0, MAX_ERROR_DETAIL_LENGTH)
  });
}

export function sanitizeObservationFailure(error) {
  const allowed=new Set(['REQUEST_TIMEOUT','NETWORK_FAILURE','PROVIDER_FAILURE','PROVIDER_UNAVAILABLE','MARKET_DATA_UNAVAILABLE','MARKET_DATA_INVALID','HTTP_FAILURE','CYCLE_ERROR','EVIDENCE_TARGET_INVALID']);
  if(typeof error==='string'&&allowed.has(error.trim().toUpperCase()))return error.trim().toUpperCase();
  const diagnostic=sanitizeCycleError(error);
  if(diagnostic.errorCode==='REQUEST_TIMEOUT')return 'REQUEST_TIMEOUT';
  if(/^NETWORK_(ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED)$/.test(diagnostic.errorCode))return 'NETWORK_FAILURE';
  if(/^HTTP_\d{3}$/.test(diagnostic.errorCode))return 'HTTP_FAILURE';
  return 'CYCLE_ERROR';
}

export function classifyObservationFailure(value) {
  const code=String(value?.status??value?.message??value??'').trim().toUpperCase();
  const integrity=code==='PAPER_OUTCOME_SETTLEMENT_ERROR'||/^(EVIDENCE_|JOURNAL_|WAL_|PROJECTION_|GENERATION_|WRITER_|OBSERVATION_TERMINAL_|CYCLE_NOT_|HISTORY_INVENTORY_|INCOMPATIBLE_DUPLICATE|ACTIVE_|CAPABILITY_|MEMBERSHIP_|INVALID_CREATION|INTENT_REQUIRED)/.test(code);
  return Object.freeze({classification:integrity?'EVIDENCE_INTEGRITY_FAILURE':'OPERATIONAL_FAILURE',reasonCode:integrity?null:sanitizeObservationFailure(value?.status??value)});
}

function loadCompleted(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {ids:[],summaries:{}};
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(saved?.completedCycleIds)) throw new Error('Estado durável do monitor inválido.');
  if (saved.cycleSummaries != null && (typeof saved.cycleSummaries !== 'object' || Array.isArray(saved.cycleSummaries))) throw new Error('Estado durável do monitor inválido.');
  const summaries=Object.fromEntries(Object.entries(saved.cycleSummaries??{}).filter(([id])=>/^autonomous-paper-monitor-v1:\d+$/.test(id))
    .map(([id,summary])=>[id,sanitizeCycleSummary(summary)]).filter(([,summary])=>summary));
  return {ids:saved.completedCycleIds.filter((id) => typeof id === 'string'),summaries};
}

function persistCompleted(filePath, ids, summaries = null) {
  if (!filePath) throw new Error('DURABLE_STATE_REQUIRED');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  const fd=fs.openSync(temporary,'w');
  try {fs.writeFileSync(fd, JSON.stringify({ monitorVersion: PAPER_MONITOR_VERSION, completedCycleIds: [...ids],
    ...(summaries ? {cycleSummaries:summaries} : {}) }, null, 2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary, filePath);
}

/**
 * Bounded PAPER-only scheduler. The injected runCycle may observe/analyze but
 * receives no execution capability and must return its own fail-closed result.
 */
export function createAutonomousPaperMonitor({
  enabled = false,
  intervalMs = MIN_INTERVAL_MS,
  filePath = null,
  runCycle,
  cycleEvidence = null,
  captureCycleSummary = false,
  now = () => Date.now(),
  onEvent = () => {},
  logger = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (!Number.isFinite(Number(intervalMs)) || Number(intervalMs) < MIN_INTERVAL_MS) throw new Error(`MONITOR_INTERVAL_MIN_${MIN_INTERVAL_MS}`);
  if (typeof runCycle !== 'function') throw new Error('MONITOR_CYCLE_HANDLER_REQUIRED');
  let completed,cycleSummaries={};
  try { const loaded=filePath?loadCompleted(filePath):null;completed=loaded?new Set(loaded.ids):null;cycleSummaries=loaded?.summaries??{}; } catch (error) { completed = null; }
  let running = false;
  let timer = null;
  let last = null;
  let evidenceInitialized = false;
  let evidencePaused = false;

  async function runEvidenceCycle(id) {
    const terminate = (summary = null) => {
      const next = new Set(completed); next.add(id);
      if(captureCycleSummary&&summary)cycleSummaries[id]=sanitizeCycleSummary(summary);
      persistCompleted(filePath, next, Object.keys(cycleSummaries).length?cycleSummaries:null); completed = next;
    };
    try {
      cycleEvidence.openMonitorCycle(id);
      let result;
      try {
        const capability=cycleEvidence.issueRequestCapability(id);
        result = await runCycle({cycleId:id,mode:'PAPER',capability});
      }
      catch (error) {
        const failure=classifyObservationFailure(error);
        if (cycleEvidence.health().paused || failure.classification==='EVIDENCE_INTEGRITY_FAILURE') throw new Error('EVIDENCE_PAUSED');
        if (cycleEvidence.health().observationTerminalRequired) {
          cycleEvidence.commitObservationTerminal(id,{outcome:'OPERATIONAL_FAILURE',reasonCode:failure.reasonCode});
          cycleEvidence.sealMonitorCycle(id); terminate();
          return event({ran:false,status:'OBSERVATION_OPERATIONAL_FAILURE',reason:'CYCLE_FAILURE',cycleId:id,mode:'PAPER'});
        }
        cycleEvidence.invalidateMonitorCycle(id); terminate();
        return event({ran:false,status:'SKIPPED_INVALID_CYCLE',reason:'CYCLE_FAILURE',cycleId:id,mode:'PAPER'});
      }
      if (cycleEvidence.health().paused) throw new Error('EVIDENCE_PAUSED');
      if(captureCycleSummary&&result?.ok===true&&!result?.reasonSummary)throw new Error('COMMISSIONING_SUMMARY_REQUIRED');
      if(captureCycleSummary&&result?.ok===true&&result?.reasonSummary){
        cycleSummaries[id]=sanitizeCycleSummary(result.reasonSummary);
        // Durable before seal: recovery can never mark a zero-record SUCCESS
        // complete without its already-persisted sanitized reason summary.
        persistCompleted(filePath,completed,cycleSummaries);
      }
      if (cycleEvidence.health().observationTerminalRequired) {
        const failure=result?.ok===true?null:classifyObservationFailure(result);
        if(failure?.classification==='EVIDENCE_INTEGRITY_FAILURE')throw new Error('EVIDENCE_PAUSED');
        cycleEvidence.commitObservationTerminal(id,result?.ok===true?{outcome:'SUCCESS'}:{outcome:'OPERATIONAL_FAILURE',reasonCode:failure.reasonCode});
        cycleEvidence.sealMonitorCycle(id);
      } else if (result?.ok === true) cycleEvidence.sealMonitorCycle(id);
      else cycleEvidence.invalidateMonitorCycle(id);
      terminate(result?.ok===true?result?.reasonSummary:null);
      return event({ran:result?.ok===true,status:result?.ok === true?'COMPLETED':cycleEvidence.health().observationTerminalRequired?'OBSERVATION_OPERATIONAL_FAILURE':'SKIPPED_INVALID_CYCLE',cycleId:id,mode:'PAPER'});
    } catch {
      evidencePaused = true; cycleEvidence.pause();
      return event({ran:false,status:'PAUSED',reason:'STORAGE_FAILURE',cycleId:id,mode:'PAPER'});
    } finally { running = false; }
  }

  function cycleId(at = now()) {
    if (!Number.isFinite(Number(at))) return null;
    return `${PAPER_MONITOR_VERSION}:${Math.floor(Number(at) / Number(intervalMs))}`;
  }

  function event(value) {
    last = { ...value, emittedAt: new Date(Number.isFinite(Number(now())) ? Number(now()) : Date.now()).toISOString() };
    onEvent(structuredClone(last));
    return structuredClone(last);
  }

  async function runOnce({ at = now() } = {}) {
    if (!enabled) return event({ ran: false, status: 'DISABLED', mode: 'PAPER' });
    if (!completed) return event({ ran: false, status: 'PAUSED', reason: 'DURABLE_STATE_UNAVAILABLE', mode: 'PAPER' });
    if (cycleEvidence) {
      if (evidencePaused || cycleEvidence.health().paused) return event({ran:false,status:'PAUSED',reason:'STORAGE_FAILURE',mode:'PAPER'});
      if (!evidenceInitialized) {
        try {
          const recovery=cycleEvidence.recover();
          const next=new Set([...completed,...recovery.sealedCycleIds]);
          persistCompleted(filePath,next,Object.keys(cycleSummaries).length?cycleSummaries:null); completed=next; evidenceInitialized=true;
        } catch {
          evidencePaused=true; cycleEvidence.pause();
          return event({ran:false,status:'PAUSED',reason:'STORAGE_FAILURE',mode:'PAPER'});
        }
      }
      if (cycleEvidence.health().collectionClosed) return event({ran:false,status:'COLLECTION_CLOSED',reason:'CANDIDATE_LIMIT_REACHED',mode:'PAPER'});
    }
    const id = cycleId(at);
    if (!id) return event({ ran: false, status: 'PAUSED', reason: 'CLOCK_FAILURE', mode: 'PAPER' });
    if (running) return event({ ran: false, status: 'OVERLAP_SKIPPED', cycleId: id, mode: 'PAPER' });
    if (completed.has(id)) return event({ ran: false, status: 'IDEMPOTENT', cycleId: id, mode: 'PAPER' });
    running = true;
    if (cycleEvidence) return runEvidenceCycle(id);
    try {
      const result = await runCycle({ cycleId: id, mode: 'PAPER' });
      // A provider/data failure is a completed invalid observation for this
      // cadence slot; retrying it in a tight loop would violate provider limits.
      const next=new Set(completed);next.add(id);
      if(captureCycleSummary&&result?.ok!==false&&result?.reasonSummary)cycleSummaries[id]=sanitizeCycleSummary(result.reasonSummary);
      persistCompleted(filePath, next, Object.keys(cycleSummaries).length?cycleSummaries:null);completed=next;
      return event({ ran: true, status: result?.ok === false ? 'SKIPPED_INVALID_CYCLE' : 'COMPLETED', cycleId: id, mode: 'PAPER', result: result ?? null });
    } catch (error) {
      // Do not invent a WAIT, quote, or outcome when the observation failed.
      const diagnostic = sanitizeCycleError(error);
      try {
        const next=new Set(completed);next.add(id);
        persistCompleted(filePath, next, Object.keys(cycleSummaries).length?cycleSummaries:null);completed=next;
        const failed = event({ ran: false, status: 'SKIPPED_INVALID_CYCLE', reason: 'CYCLE_FAILURE', cycleId: id, mode: 'PAPER', ...diagnostic });
        try { logger(structuredClone(failed)); } catch {}
        return failed;
      } catch {
        return event({ ran: false, status: 'PAUSED', reason: 'STORAGE_FAILURE', cycleId: id, mode: 'PAPER' });
      }
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || !enabled) return health();
    timer = setIntervalFn(() => { void runOnce(); }, Number(intervalMs));
    void runOnce();
    return health();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    return health();
  }

  function health() {
    return {
      monitorVersion: PAPER_MONITOR_VERSION,
      mode: 'PAPER',
      enabled,
      intervalMs: Number(intervalMs),
      running,
      scheduled: Boolean(timer),
      durableState: completed ? 'AVAILABLE' : 'UNAVAILABLE',
      completedCycles: completed?.size ?? 0,
      last: last ? structuredClone(last) : null,
      ...(captureCycleSummary?{cycleSummaries:structuredClone(Object.fromEntries(Object.entries(cycleSummaries).filter(([id])=>completed?.has(id))))}:{})
    };
  }

  return { cycleId, runOnce, start, stop, health };
}

