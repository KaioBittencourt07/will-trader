import 'dotenv/config';
import { runTwelveR8kExecution } from './twelveR8kExecution.js';

console.log(JSON.stringify(await runTwelveR8kExecution(), null, 2));
