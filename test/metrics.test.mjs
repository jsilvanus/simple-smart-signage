import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../src/metrics.mjs';

test('counters and gauges render', () => {
  const m = createMetrics();
  m.inc('a_total', { x: 'q"1' });
  m.inc('a_total', { x: 'q"1' }, 2);
  m.set('g', 5);
  assert.equal(m.get('a_total', { x: 'q"1' }), 3);
  const out = m.render();
  assert.match(out, /a_total\{x="q\\"1"\} 3/);
  assert.match(out, /# TYPE g gauge\ng 5/);
});
