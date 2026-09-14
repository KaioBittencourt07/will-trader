export const SCANNER_ROUND_STATE_VERSION = 'scanner-round-state-v2';

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
    const duplicates = rejected.filter((item) => item?.error === 'DUPLICATE_CANONICAL_STUDY').length;
    const admissionRejected = rejected.some((item) => item?.error === 'MARKET_ADMISSION_REJECTED');
    const canonicalRejected = rejected.some((item) => item?.error === 'CANONICAL_SNAPSHOT_REJECTED');

    if (duplicates > 0 && !admissionRejected && !canonicalRejected) {
      return Object.freeze({
        version: SCANNER_ROUND_STATE_VERSION,
        state: 'NO_NEW_CANONICAL_STUDY',
        strategicWait: false,
        admittedStudies: 0,
        rejectedObservations: rejected.length,
        duplicateStudies: duplicates,
        reason: 'O estado canônico já foi estudado; nenhuma evidência duplicada foi gravada.'
      });
    }

    return Object.freeze({
      version: SCANNER_ROUND_STATE_VERSION,
      state: 'NO_ADMITTED_MARKET_STUDY',
      strategicWait: false,
      admittedStudies: 0,
      rejectedObservations: rejected.length,
      duplicateStudies: duplicates,
      reason: admissionRejected
        ? 'Nenhum estudo foi admitido pelo Market Admission Gate nesta rodada.'
        : canonicalRejected
          ? 'Nenhum snapshot admitido cumpriu o contrato canônico nesta rodada.'
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
    duplicateStudies: rejected.filter((item) => item?.error === 'DUPLICATE_CANONICAL_STUDY').length,
    reason: allWait
      ? 'Os estudos admitidos resultaram em WAIT estratégico.'
      : 'Houve estudo admitido, mas nenhum candidato foi liberado.'
  });
}
