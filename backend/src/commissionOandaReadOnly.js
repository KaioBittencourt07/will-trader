import 'dotenv/config';
import { runOandaCommissioning } from './oandaCommissioning.js';

console.log(JSON.stringify(await runOandaCommissioning(), null, 2));
