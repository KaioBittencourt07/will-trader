import { runWillPipeline } from './pipeline.js';

export function replayMarket({ candles = [], context = {}, onSignal = null } = {}) {
  const ordered = [...candles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const results = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const window = ordered.slice(0, i + 1);
    const latest = window.at(-1);
    const decision = runWillPipeline(latest, { ...context, candles: window });
    const item = { index: i, timestamp: latest.timestamp, market: latest, decision };
    results.push(item);
    if (typeof onSignal === 'function') onSignal(item);
  }
  return results;
}

export function summarizeReplay(results = []) {
  const signals = results.filter(r => r.decision?.executable);
  return {
    candles: results.length,
    signals: signals.length,
    buys: signals.filter(r => r.decision.direction === 'BUY').length,
    sells: signals.filter(r => r.decision.direction === 'SELL').length,
    waits: results.length - signals.length
  };
}
