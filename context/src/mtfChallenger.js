export const MTF_VERSION = 'mtf-shadow-v1';
export function evaluateMtfShadow({ champion = {}, views = [] } = {}) {
  const critical = ['higher', 'operational']; const byRole = Object.fromEntries(views.map(v => [v.role, v]));
  if (critical.some(role => !byRole[role] || byRole[role].valid === false || byRole[role].status === 'STALE')) return { mode: 'SHADOW', mtfVersion: MTF_VERSION, status: 'MTF_UNKNOWN', evidence: views, agreement: 'UNKNOWN' };
  const directions = views.map(v => v.direction).filter(Boolean); const agreed = directions.filter(d => d === champion.direction).length;
  return { mode: 'SHADOW', mtfVersion: MTF_VERSION, status: 'MTF_READY', evidence: views, agreement: agreed === directions.length ? 'AGREE' : agreed ? 'PARTIAL' : 'DISAGREE' };
}
