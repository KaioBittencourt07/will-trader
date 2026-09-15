import 'dotenv/config';
import { buildCrossProviderReadinessReport } from '../../data/src/crossProviderCommissioningReadiness.js';

// Phase 13A is deliberately local-only. This command has no network client and
// cannot execute 13B; it prints only a sanitized configuration readiness report.
console.log(JSON.stringify(buildCrossProviderReadinessReport({ env: process.env }), null, 2));
