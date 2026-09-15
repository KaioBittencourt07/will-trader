export function createDecisionRecord(input) {
  return {
    id: input?.id ?? crypto.randomUUID(),
    createdAt: input?.createdAt ?? new Date().toISOString(),
    asset: input?.asset ?? null,
    timestamp: input?.timestamp ?? null,
    price: Number(input?.price),
    timeframe: input?.timeframe ?? null,
    regime: input?.regime ?? 'UNKNOWN',
    setup: input?.setup ?? 'UNKNOWN',
    direction: input?.direction ?? 'WAIT',
    score: Number(input?.score ?? 0),
    confidence: Number(input?.confidence ?? 0),
    payout: input?.payout == null ? null : Number(input.payout),
    confirmations: input?.confirmations ?? [],
    risks: input?.risks ?? [],
    reason: input?.reason ?? '',
    outcome: input?.outcome ?? 'PENDING',
    errorTag: input?.errorTag ?? null
  };
}
