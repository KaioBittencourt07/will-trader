import test from 'node:test';
import assert from 'node:assert/strict';
import { BIQUOTE_FOREX_PRODUCTS } from '../backend/src/biquoteForexRuntimeFeed.js';
import { buildCommissioningStatus, projectBiquoteCommissioningHealth } from '../backend/src/finalCommissioning.js';

const assets=()=>Object.fromEntries(Object.keys(BIQUOTE_FOREX_PRODUCTS).map(asset=>[asset,{ready:true}]));
const ledger={snapshot:()=>({entries:{},cycles:{}})};
const status=health=>buildCommissioningStatus({ledger,providers:{biquote:projectBiquoteCommissioningHealth(health)}});

test('Biquote CONNECTED is connected and ready only with every configured asset ready',()=>{
  const health={enabled:true,running:true,state:'CONNECTED',lastHttpStatus:200,successfulPolls:3,assets:assets()};
  const projected=projectBiquoteCommissioningHealth(health);
  assert.equal(projected.state,'CONNECTED');
  assert.equal(projected.ready,true);
  assert.deepEqual(status(health).providerStatus.biquote,{enabled:true,running:true,ready:true,connected:true});
  assert.equal(status(health).automatedBrokerExecution,false);
  health.assets['EUR/USD'].ready=false;
  assert.deepEqual(status(health).providerStatus.biquote,{enabled:true,running:true,ready:false,connected:true});
  delete health.assets['EUR/USD'];
  assert.equal(status(health).providerStatus.biquote.ready,false);
});

test('Biquote non-connected states never claim connection or readiness despite stale ready assets',()=>{
  for(const state of ['STARTING','ERROR','STOPPED','DISABLED']){
    const health={enabled:state!=='DISABLED',running:state==='STARTING'||state==='ERROR',state,
      lastHttpStatus:200,successfulPolls:5,assets:assets(),connected:true,ready:true};
    assert.equal(projectBiquoteCommissioningHealth(health).state,state);
    assert.equal(status(health).providerStatus.biquote.connected,false,state);
    assert.equal(status(health).providerStatus.biquote.ready,false,state);
  }
});

test('Biquote readiness cannot be invented from polls, absent asset map or disconnected flags',()=>{
  for(const health of [
    {enabled:true,running:true,state:'CONNECTED',successfulPolls:1,lastHttpStatus:200},
    {enabled:true,running:false,state:'CONNECTED',assets:assets()},
    {enabled:false,running:true,state:'CONNECTED',assets:assets()}
  ]) assert.equal(status(health).providerStatus.biquote.ready,false);
  assert.equal(status({enabled:true,running:true,state:'CONNECTED',assets:assets()}).providerStatus.biquote.connected,true);
});
