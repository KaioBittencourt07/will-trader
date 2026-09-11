import assert from 'node:assert/strict';
import test from 'node:test';
import { runTwelveR8kExecution, TWELVE_R8K_AUTHORIZATION } from '../backend/src/twelveR8kExecution.js';

const env = { WILL_TWELVE_R8K_ENABLED: 'true', WILL_TWELVE_R8K_AUTHORIZATION: TWELVE_R8K_AUTHORIZATION, TWELVEDATA_API_KEY: 'local-secret' };
const metadata = { eventFieldPresent:true, symbolFieldPresent:true, timestampFieldPresent:true, timestampFinite:true, timestampUnitObserved:'UNIX_SECONDS', timestampDistinctCount:2, timestampAdvanceCount:1, timestampRegressionCount:0, repeatedTimestampCount:27, minPositiveTimestampStepMs:60000, maxPositiveTimestampStepMs:60000, arrivalAdvanceCount:28, arrivalRegressionCount:0, rawPayloadRetained:false, rawPriceRetained:false, rawTimestampRetained:false };
const observed = { metadata, connections:1, subscribeAttempts:1, retries:0, reconnects:0, redirects:0, restRequests:0, externalProviderCalls:1, observationWindowMs:60000, preAcceptTimeoutMs:5000, heartbeatIntervalMs:10000, providerCommissioning:false, decisionImpact:'NONE', prospectivePaperAuthorized:false, ordersExecuted:0, secretExposed:false };

test('blocks before observer without exact fresh R8K authorization', async () => {
  let calls = 0;
  const result = await runTwelveR8kExecution({ env:{ ...env, WILL_TWELVE_R8K_AUTHORIZATION:'R8J_TEMPORAL_SEMANTICS_EXPLICITLY_AUTHORIZED' }, observer:async()=>{calls++;} });
  assert.equal(result.result,'BLOCKED'); assert.equal(calls,0); assert.equal(result.externalProviderCalls,0);
});

test('invokes one bounded metadata-only observation', async () => {
  let input;
  const result = await runTwelveR8kExecution({ env, observer:async(value)=>{input=value; return observed;} });
  assert.equal(result.result,'OBSERVED'); assert.equal(input.metadataOnly,true); assert.equal(input.observationWindowMs,60000);
  assert.equal(result.freshnessContractMs,30000); assert.equal(result.timestampSemantics,'UNVERIFIED_PENDING_EVIDENCE_REVIEW');
  assert.equal(result.providerCommissioning,false); assert.equal(result.prospectivePaperAuthorized,false); assert.equal(result.ordersExecuted,0);
});

test('rejects raw payload or price retention', async () => {
  const result = await runTwelveR8kExecution({ env, observer:async()=>({ ...observed, metadata:{...metadata, rawPriceRetained:true} }) });
  assert.equal(result.result,'BLOCKED'); assert.deepEqual(result.reasonCodes,['UNSANITIZED_OR_OUT_OF_BOUNDS_OBSERVATION']);
});

test('rejects network budget escalation', async () => {
  const result = await runTwelveR8kExecution({ env, observer:async()=>({ ...observed, connections:2 }) });
  assert.equal(result.result,'BLOCKED'); assert.equal(result.externalProviderCalls,0);
});

test('observed metadata never proves timestamp semantics automatically', async () => {
  const result = await runTwelveR8kExecution({ env, observer:async()=>observed });
  assert.equal(result.metadata.minPositiveTimestampStepMs,60000);
  assert.equal(result.timestampSemantics,'UNVERIFIED_PENDING_EVIDENCE_REVIEW');
  assert.equal(result.decisionImpact,'NONE');
});
