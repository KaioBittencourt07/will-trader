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

  return {
    schemaVersion: 'will-legacy-backtest-v1',
    mode: 'LEGACY_CANDLE_PRICE_PROXY_NOT_EXECUTION_ACCURATE',
    decisions,
    trades,
    performance: {
      ...calculatePerformance(trades),
      pnlSemantics: 'RAW_PRICE_DELTA_NOT_CASH_PNL',
      winRateSemantics: 'OUTCOME_FREQUENCY_WITHOUT_PAYOUT_OR_COST_MODEL',
      entryFillModel: 'CURRENT_CANDLE_PRICE_AT_DECISION_TIME_NOT_VERIFIED_BROKER_FILL',
      expiryModel: 'CANDLE_INDEX_OFFSET_NOT_VERIFIED_BROKER_EXPIRY',
      edgeProven: false
    },
    warnings: [
      'Legacy compatibility backtest only; entry/fill and settlement rules are not an execution-accurate historical replay.',
      'Performance.pnl is raw price movement, not account-currency or payout-aware financial PnL.',
      'Use backtest/src/willStrategyReplay.js plus a verified historical dataset for strict point-in-time analysis.'
    ],
    edgeProven: false
  };
}
