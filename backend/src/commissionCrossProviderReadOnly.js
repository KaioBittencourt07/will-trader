import 'dotenv/config';
import { runCrossProviderCommissioning } from './crossProviderCommissioning.js';

console.log(JSON.stringify(await runCrossProviderCommissioning(), null, 2));
