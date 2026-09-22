const PROTECTED_PROTOCOL = /^will-edge-gate-oos2[a-z0-9-]*-v\d+$/;

export const PROTECTED_PROSPECTIVE_MUTATION_ERROR = 'PROTECTED_PROSPECTIVE_MUTATION_FORBIDDEN';

export function isProtectedProspectiveRecord(record) {
  return Boolean(record
    && PROTECTED_PROTOCOL.test(String(record.protocolId ?? ''))
    && typeof record.campaignId === 'string' && record.campaignId.length > 0
    && typeof record.cycleId === 'string' && record.cycleId.length > 0
    && Number.isInteger(record.writerGeneration) && record.writerGeneration > 0);
}

export function assertManualMutationAllowed(record) {
  if (isProtectedProspectiveRecord(record)) throw new Error(PROTECTED_PROSPECTIVE_MUTATION_ERROR);
}
