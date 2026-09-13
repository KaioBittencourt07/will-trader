/**
 * Provider evidence is the only launch dependency for PAPER research. Broker
 * availability is intentionally absent from this contract: it belongs to the
 * separate manual execution/mapping layer.
 */
export function prospectiveResearchGate(diagnostic) {
  const providerStatus = diagnostic?.diagnostic?.status ?? diagnostic?.status ?? 'UNVERIFIED';
  const ready = diagnostic?.ok === true && providerStatus === 'HEALTHY';
  return Object.freeze({
    ready,
    status: ready ? 'MARKET_DATA_GATE_HEALTHY' : `MARKET_DATA_GATE_${providerStatus}`,
    providerStatus
  });
}

