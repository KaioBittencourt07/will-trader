export function expiryAt(record) {
  const seconds = Number(record?.metadata?.context?.expirySeconds);
  const started = Date.parse(record?.execution?.actualClickTime ?? record?.execution?.plannedClickTime ?? record?.clickTime ?? record?.signalTimestamp ?? record?.createdAt ?? '');
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(started)) return null;
  return started + seconds * 1_000;
}

/** Resolves only PAPER outcomes against a documented prospective reference price. */
export function resolveProspectiveOutcome(record, { price, timestamp = new Date().toISOString() } = {}, now = Date.now()) {
  if (record?.status !== 'OPEN') throw new Error('Somente sinais PAPER abertos podem ser resolvidos.');
  if (!['BUY', 'SELL'].includes(record.direction)) throw new Error('Direção de sinal inválida para resolução.');
  const dueAt = expiryAt(record);
  if (!dueAt) throw new Error('Sinal sem expiração válida.');
  if (now < dueAt) return { resolved: false, reason: 'EXPIRY_NOT_REACHED', dueAt: new Date(dueAt).toISOString() };
  const referenceMs = Date.parse(timestamp);
  if (!Number.isFinite(referenceMs)) throw new Error('Timestamp de referência inválido para resolução.');
  if (referenceMs < dueAt) return { resolved: false, reason: 'REFERENCE_BEFORE_EXPIRY', dueAt: new Date(dueAt).toISOString() };
  const entry = Number(record.execution?.actualEntryPrice ?? record.entryPrice);
  const exit = Number(price);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) throw new Error('Preço inválido para resolução.');
  const change = exit - entry;
  const outcome = change === 0 ? 'VOID' : ((record.direction === 'BUY' && change > 0) || (record.direction === 'SELL' && change < 0) ? 'WIN' : 'LOSS');
  return { resolved: true, outcome, exitPrice: exit, entryPrice: entry, referenceTimestamp: new Date(referenceMs).toISOString(), dueAt: new Date(dueAt).toISOString() };
}
