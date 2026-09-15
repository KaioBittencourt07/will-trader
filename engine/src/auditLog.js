export function createAuditEntry({ signal = {}, decision = {}, context = {} } = {}) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    asset: signal.asset ?? decision.asset ?? null,
    direction: decision.direction ?? 'WAIT',
    clickTime: decision.direction === 'BUY' || decision.direction === 'SELL' ? (decision.clickTime ?? null) : null,
    confidence: decision.confidence ?? 0,
    regime: decision.regime ?? null,
    setup: decision.setup ?? null,
    blocked: Boolean(decision.blocked),
    blockReasons: Array.isArray(decision.blockReasons) ? decision.blockReasons : [],
    macroBlocked: Boolean(context.macroBlocked),
    newsBlocked: Boolean(context.newsBlocked),
    dataValid: context.dataValid !== false,
    outcome: null
  };
}

export function closeAuditEntry(entry, outcome, metadata = {}) {
  if (!['WIN', 'LOSS', 'VOID'].includes(outcome)) throw new Error('Outcome inválido.');
  return { ...entry, outcome, result: metadata.result ?? null, closedAt: new Date().toISOString() };
}
