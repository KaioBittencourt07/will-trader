import 'dotenv/config';
import { runTwelveR8jExecution } from './twelveR8jExecution.js';

console.log(JSON.stringify(await runTwelveR8jExecution(), null, 2));
