const DIRECTIONS = new Set(['BUY', 'SELL', 'WAIT']);

function directionFor(snapshot) {
  const directional = Number(snapshot.trend ?? 0) * 0.35 + Number(snapshot.momentum ?? 0) * 0.30 + Number(snapshot.structure ?? 0) * 0.35;
  return directional > 0.15 ? 'BUY' : directional < -0.15 ? 'SELL' : 'WAIT';
}

export function buildMultiTimeframeContext(snapshots = []) {
  const valid = snapshots.filter((snapshot) => snapshot?.valid !== false && snapshot?.asset && snapshot?.timeframe);
  const assets = [...new Set(valid.map((snapshot) => snapshot.asset))];
  if (assets.length > 1) throw new Error('Multi-timeframe exige snapshots do mesmo ativo.');
  const views = valid.map((snapshot) => ({ timeframe: snapshot.timeframe, direction: DIRECTIONS.has(snapshot.direction) ? snapshot.direction : directionFor(snapshot), timestamp: snapshot.timestamp ?? null, dataStatus: snapshot.status ?? null }));
  const directional = views.map((view) => view.direction).filter((direction) => direction !== 'WAIT');
  const direction = directional.length && new Set(directional).size === 1 ? directional[0] : 'WAIT';
  return { asset: assets[0] ?? null, views, direction, aligned: direction !== 'WAIT' && directional.length >= 2, status: valid.length ? 'READY' : 'INSUFFICIENT_DATA' };
}
