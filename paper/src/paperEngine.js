export function createPaperOrder(signal, { stake = 1 } = {}) {
  if (!signal || signal.direction === 'WAIT' || signal.blocked) return { status: 'BLOCKED', signal, stake: 0 };
  return { id: crypto.randomUUID(), status: 'OPEN', createdAt: new Date().toISOString(), direction: signal.direction, asset: signal.asset, timeframe: signal.timeframe, entryPrice: signal.price, stake, signalId: signal.id ?? null };
}

export function closePaperOrder(order, outcome, exitPrice = null) {
  if (!order || order.status !== 'OPEN') throw new Error('Ordem não está aberta.');
  if (!['WIN', 'LOSS', 'VOID'].includes(outcome)) throw new Error('Outcome inválido.');
  return { ...order, status: 'CLOSED', outcome, exitPrice, closedAt: new Date().toISOString() };
}
