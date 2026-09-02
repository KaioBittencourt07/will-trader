import fs from 'node:fs';
import path from 'node:path';

const OUTCOMES = new Set(['WIN', 'LOSS', 'VOID']);

function dataQuality(data = {}) {
  return { valid: data.valid !== false, status: data.status ?? null, ageMs: Number.isFinite(data.ageMs) ? data.ageMs : null, source: data.source ?? null, quoteTimestamp: data.quoteTimestamp ?? null, candleTimestamp: data.candleTimestamp ?? null, candleCount: Number.isFinite(data.candleCount) ? data.candleCount : null };
}

export function createHistoryStore({ filePath = null, now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) {
  let records = [];
  if (filePath && fs.existsSync(filePath)) {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('Histórico persistido inválido.');
    records = saved;
  }
  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records, null, 2));
    fs.renameSync(temporary, filePath);
  }
  function recordDecision({ decision = {}, data = {}, audit = {}, context = {} } = {}) {
    const direction = decision.direction ?? 'WAIT';
    const executable = (direction === 'BUY' || direction === 'SELL') && !decision.blocked && decision.executable !== false;
    const record = { id: id(), createdAt: now(), signalTimestamp: decision.generatedAt ?? data.timestamp ?? null, asset: data.asset ?? decision.asset ?? audit.asset ?? null, timeframe: data.timeframe ?? decision.timeframe ?? null, entryPrice: Number(data.price ?? decision.price) || null, direction, status: executable ? 'OPEN' : 'SKIPPED', score: Number(decision.score) || 0, confidence: Number(decision.confidence) || 0, regime: decision.regime ?? null, setup: decision.setup ?? null, confirmations: Number(data.confirmations ?? decision.confirmations) || 0, clickTime: executable ? (decision.clickTime ?? null) : null, execution: executable ? { status: 'PENDING_CONFIRMATION', plannedClickTime: decision.clickTime ?? null, actualClickTime: null, actualEntryPrice: null, confirmedAt: null } : null, outcome: null, metadata: { blockReasons: Array.isArray(decision.blockReasons) ? decision.blockReasons : [], dataQuality: dataQuality(data), context: { expirySeconds: context.expirySeconds ?? null } } };
    records.push(record);
    persist();
    return record;
  }
  function settle(idValue, outcome, metadata = {}) {
    if (!OUTCOMES.has(outcome)) throw new Error('Outcome inválido.');
    const index = records.findIndex((record) => record.id === idValue);
    if (index < 0) throw new Error('Sinal não encontrado.');
    if (records[index].status !== 'OPEN') throw new Error('Somente sinais abertos podem receber outcome.');
    if (records[index].outcome) throw new Error('Outcome já registrado.');
    records[index] = { ...records[index], status: 'CLOSED', outcome, exitPrice: Number(metadata.exitPrice) || null, settledAt: now(), outcomeMetadata: metadata };
    persist();
    return records[index];
  }
  function confirmExecution(idValue, { actualClickTime, actualEntryPrice = null, notes = null } = {}) {
    const index = records.findIndex((record) => record.id === idValue);
    if (index < 0) throw new Error('Sinal não encontrado.');
    if (records[index].status !== 'OPEN') throw new Error('Somente sinais abertos podem confirmar execução.');
    const clickMs = Date.parse(actualClickTime ?? '');
    if (!Number.isFinite(clickMs)) throw new Error('Horário real do clique inválido.');
    const entryPrice = actualEntryPrice == null || actualEntryPrice === '' ? null : Number(actualEntryPrice);
    if (entryPrice !== null && (!Number.isFinite(entryPrice) || entryPrice <= 0)) throw new Error('Preço real de entrada inválido.');
    records[index] = {
      ...records[index],
      execution: {
        ...(records[index].execution ?? { plannedClickTime: records[index].clickTime ?? null }),
        status: 'CONFIRMED',
        actualClickTime: new Date(clickMs).toISOString(),
        actualEntryPrice: entryPrice,
        confirmedAt: now(),
        notes: typeof notes === 'string' ? notes.slice(0, 500) : null
      }
    };
    persist();
    return records[index];
  }
  return { recordDecision, settle, confirmExecution, list: () => records.map((record) => structuredClone(record)) };
}
