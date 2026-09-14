export const SCANNER_ROUND_STATE_VERSION = 'scanner-round-state-v1';

export function deriveScannerRoundState({ analyses = [], unavailable = [], recommendation = null } = {}) {
  const admitted = Array.isArray(analyses) ? analyses : [];
  const rejected = Array.isArray(unavailable) ? unavailable : [];

  if (recommendation) {
    return Object.freeze({
      version: SCANNER_ROUND_STATE_VERSION,
      state: 'CANDIDATE_AVAILABLE',
      strategicWait: false,
      admittedStudies: admitted.length,
      rejectedObservations: rejected.length,
      reason: 'Há candidato derivado de estudo admitido.'
    });
  }

  if (admitted.length === 0) {
    const admissionRejected = rejected.some((item) => item?.error === 'MARKET_ADMISSION_REJECTED');
    return Object.freeze({
      version: SCANNER_ROUND_STATE_VERSION,
      state: 'NO_ADMITTED_MARKET_STUDY',
      strategicWait: false,
      admittedStudies: 0,
      rejectedObservations: rejected.length,
      reason: admissionRejected
        ? 'Nenhum estudo foi admitido pelo Market Admission Gate nesta rodada.'
        : 'Nenhum estudo de mercado válido foi admitido nesta rodada.'
    });
  }

  const allWait = admitted.every((item) => item?.decision?.direction === 'WAIT');
  return Object.freeze({
    version: SCANNER_ROUND_STATE_VERSION,
    state: allWait ? 'STRATEGIC_WAIT' : 'ADMITTED_NO_RELEASED_CANDIDATE',
    strategicWait: allWait,
    admittedStudies: admitted.length,
    rejectedObservations: rejected.length,
    reason: allWait
      ? 'Os estudos admitidos resultaram em WAIT estratégico.'
      : 'Houve estudo admitido, mas nenhum candidato foi liberado.'
  });
}
