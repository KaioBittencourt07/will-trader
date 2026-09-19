import { randomUUID } from 'node:crypto';

export function createTradeRecord({ signalId = randomUUID(), asset, direction, entryPrice, entryTime, expirySeconds = 60, result = 'PENDING', exitPrice = null, exitTime = null, source = 'paper' } = {}) {
  return { signalId, asset, direction, entryPrice: Number(entryPrice), entryTime, expirySeconds, result, exitPrice, exitTime, source };
}

export function settleTrade(record, exitPrice, exitTime = new Date().toISOString()) {
  const move = Number(exitPrice) - Number(record.entryPrice);
  const pnlDirection = record.direction === 'SELL' ? -1 : 1;
  const pnl = move * pnlDirection;
  return { ...record, exitPrice: Number(exitPrice), exitTime, result: pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'DRAW', pnl };
}

export function calculatePerformance(records = []) {
  const settled = records.filter(r => ['WIN', 'LOSS', 'DRAW'].includes(r.result));
  const wins = settled.filter(r => r.result === 'WIN').length;
  const losses = settled.filter(r => r.result === 'LOSS').length;
  const pnl = settled.reduce((sum, r) => sum + Number(r.pnl || 0), 0);
  return { total: settled.length, wins, losses, draws: settled.length - wins - losses, winRate: settled.length ? Number(((wins / settled.length) * 100).toFixed(2)) : 0, pnl: Number(pnl.toFixed(8)) };
}
