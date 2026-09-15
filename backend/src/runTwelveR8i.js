import 'dotenv/config';
import { runTwelveR8iExecution } from './twelveR8iExecution.js';

console.log(JSON.stringify(await runTwelveR8iExecution(), null, 2));
