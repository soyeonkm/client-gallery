// Plain assert checks for the save progress helpers. Run: node src/lib/saveProgress.test.js
import assert from 'node:assert/strict';
import { progressColor, readSaveResponse } from './saveProgress.js';

const stream = (chunks, contentType = 'application/x-ndjson') =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }), {
    headers: { 'content-type': contentType },
  });

const tests = {
  'progress colour runs light tan → bean brown → ink': () => {
    assert.equal(progressColor(0), 'rgb(201, 184, 166)');
    assert.equal(progressColor(0.5), 'rgb(91, 66, 50)');
    assert.equal(progressColor(1), 'rgb(28, 27, 25)');
    assert.equal(progressColor(2), 'rgb(28, 27, 25)', 'clamped');
  },

  'streamed save reports each progress step and returns the gallery': async () => {
    const seen = [];
    const gallery = await readSaveResponse(
      // lines split across chunks on purpose
      stream(['{"progress":{"done":0,"total":4}}\n{"progress":{"do', 'ne":2,"total":4}}\n', '{"gallery":{"id":"g1"}}\n']),
      (p) => seen.push(p)
    );
    assert.deepEqual(seen, [0, 0.5]);
    assert.deepEqual(gallery, { id: 'g1' });
  },

  'streamed save with nothing to do counts as complete': async () => {
    const seen = [];
    await readSaveResponse(stream(['{"progress":{"done":0,"total":0}}\n{"gallery":{}}\n']), (p) => seen.push(p));
    assert.deepEqual(seen, [1]);
  },

  'streamed error is thrown with its message': async () => {
    await assert.rejects(readSaveResponse(stream(['{"progress":{"done":1,"total":3}}\n{"error":"Boom"}\n']), () => {}), /Boom/);
  },

  'a stream that ends without a result is an error': async () => {
    await assert.rejects(readSaveResponse(stream(['{"progress":{"done":1,"total":3}}\n']), () => {}), /interrupted/);
  },

  'plain JSON responses still work, including errors': async () => {
    const ok = new Response(JSON.stringify({ id: 'g1' }), { headers: { 'content-type': 'application/json' } });
    assert.deepEqual(await readSaveResponse(ok, () => {}), { id: 'g1' });
    const bad = new Response(JSON.stringify({ error: 'Photographer name is required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
    await assert.rejects(readSaveResponse(bad, () => {}), /Photographer name is required/);
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
