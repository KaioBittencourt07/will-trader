import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(new URL('../tools/avalon-bridge.js', import.meta.url), 'utf8');

test('Avalon browser bridge is read-only, host-filtered and sends only allowlisted event fields', () => {
  assert.match(bridge, /ws03\.ws\.prod\.sc-ams-1a\.quadcode\.tech/);
  assert.match(bridge, /credentials: 'omit'/);
  assert.match(bridge, /X-WILL-RELAY-TOKEN/);
  assert.match(bridge, /parsed\?\.name === 'timeSync'/);
  assert.match(bridge, /parsed\?\.name !== 'candle-generated'/);
  assert.match(bridge, /const allowed = \['active_id'.*'phase'\]/);
  assert.doesNotMatch(bridge, /document\.cookie|localStorage|Authorization|password/i);
  assert.match(bridge, /window\.__WILL_AVALON_BRIDGE__/);
  assert.match(bridge, /window\.WebSocket = NativeWebSocket/);
});
