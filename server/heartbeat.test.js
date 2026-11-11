// Plain assert checks for the cron heartbeat guard. Run: node server/heartbeat.test.js
import assert from 'node:assert/strict';
import { isCronAuthorized } from './heartbeat.js';

const tests = {
  'the right secret is accepted': () => {
    assert.equal(isCronAuthorized('Bearer s3cret-value', 's3cret-value'), true);
  },
  'a wrong, missing or malformed header is rejected': () => {
    for (const header of ['Bearer wrong', 's3cret-value', '', undefined, 'Bearer ']) {
      assert.equal(isCronAuthorized(header, 's3cret-value'), false, JSON.stringify(header));
    }
  },
  'with no secret configured, everything is rejected (fail closed)': () => {
    for (const secret of [undefined, '']) {
      assert.equal(isCronAuthorized('Bearer ', secret), false);
      assert.equal(isCronAuthorized('Bearer undefined', secret), false);
    }
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
