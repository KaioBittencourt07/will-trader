import { runWillPipeline } from './pipeline.js';
import { createTradeRecord, settleTrade, calculatePerformance } from './tradeMemory.js';

export function runBacktest({ candles = [], context = {}, expiryCandles = 1 } = {}) {
  const ordered = [...candles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const trades = [];
  const decisions = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    const window = ordered.slice(0, i + 1);
    const decision = runWillPipeline(current, { ...context, candles: window });
    decisions.push({ index: i, timestamp: current.timestamp, decision });

    if (!decision.executable || !['BUY', 'SELL'].includes(decision.direction)) continue;
    const exitIndex = i + expiryCandles;
    const exit = ordered[exitIndex];
    if (!exit) continue;

    const trade = createTradeRecord({
      asset: current.asset,
      direction: decision.direction,
      entryPrice: current.price,
      entryTime: current.timestamp,
      expirySeconds: Math.max(0, Math.round((Date.parse(exit.timestamp) - Date.parse(current.timestamp)) / 1000)),
      source: 'backtest'
    });
    trades.push(settleTrade(trade, exit.price, exit.timestamp));
  }

  return { decisions, trades, performance: calculatePerformance(trades) };
}
