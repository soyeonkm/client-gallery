// Plain assert checks for gallery input rules. Run: node server/gallery.test.js
import assert from 'node:assert/strict';
import { photographerNameError } from './gallery.js';

const tests = {
  'a real photographer name is accepted': () => {
    assert.equal(photographerNameError('Jane Doe'), null);
  },
  'missing, empty or blank photographer names are rejected': () => {
    for (const name of [undefined, null, '', '   ', '\n\t']) {
      assert.equal(photographerNameError(name), 'Photographer name is required.', JSON.stringify(name));
    }
  },
  'non-text photographer names are rejected': () => {
    for (const name of [42, true, {}, ['Jane']]) {
      assert.equal(photographerNameError(name), 'Photographer name is required.', JSON.stringify(name));
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
