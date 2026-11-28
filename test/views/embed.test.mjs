import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseOrigins, validateEmbed, validateItemText, validateMembers, joinMembers, frameCsp, corsHeaders, escapeHtml } from '../../src/views/embed.mjs';

test('origins: exact https origins only, de-duplicated', () => {
  assert.deepEqual(normaliseOrigins(['https://Example.org/', 'https://example.org']), ['https://example.org']);
  assert.deepEqual(normaliseOrigins(['http://localhost:8080']), ['http://localhost:8080']);
  for (const bad of [['http://example.org'], ['https://*.example.org'], ['https://example.org/aikuistyo'], ['https://u:p@example.org'], ['javascript:alert(1)'], ['not a url']]) {
    assert.throws(() => normaliseOrigins(bad), (e) => e.status === 422, JSON.stringify(bad));
  }
});

test('embed defaults: carousel, contain, no origins (cannot be embedded yet)', () => {
  const e = validateEmbed({});
  assert.equal(e.type, 'carousel');
  assert.equal(e.options.fit, 'contain');
  assert.deepEqual(e.allowedOrigins, []);
  assert.throws(() => validateEmbed({ type: 'marquee' }), (err) => err.status === 422);
});

test('item text: plain text limits and https-only link', () => {
  const t = validateItemText({ alt: ' Kuva ', headline: 'Aikuistyö', caption: 'Torstaina', link: 'https://seurakunta.example/a?b=1' });
  assert.equal(t.alt, 'Kuva');
  assert.equal(t.link, 'https://seurakunta.example/a?b=1');
  assert.deepEqual(validateItemText({}), { alt: null, headline: null, caption: null, link: null });
  assert.throws(() => validateItemText({ link: 'http://x.example' }), (e) => e.status === 422);
  assert.throws(() => validateItemText({ headline: 'x'.repeat(121) }), (e) => e.status === 422);
});

test('members: plain ids, no duplicates, no self reference', () => {
  assert.deepEqual(validateMembers(['a', 'b'], 'agg'), ['a', 'b']);
  assert.throws(() => validateMembers(['a', 'a'], 'agg'), (e) => e.status === 422);
  assert.throws(() => validateMembers(['agg'], 'agg'), (e) => e.status === 422);
  assert.throws(() => validateMembers(['A B'], 'agg'), (e) => e.status === 422);
});

test('aggregate join keeps member order and tags each entry', () => {
  const out = joinMembers([
    { id: 'v1', entries: [{ entryId: 'e1' }] },
    { id: 'v2', entries: [{ entryId: 'e2' }, { entryId: 'e3' }] },
  ]);
  assert.deepEqual(out.map((e) => [e.entryId, e.sourceView]), [['e1', 'v1'], ['e2', 'v2'], ['e3', 'v2']]);
});

test('frame CSP: frame-ancestors is none without origins, else the list', () => {
  assert.match(frameCsp([]), /frame-ancestors 'none'/);
  assert.match(frameCsp(['https://a.example']), /frame-ancestors https:\/\/a\.example/);
  assert.match(frameCsp([]), /default-src 'none'/);
});

test('CORS: only the allowed origin is echoed', () => {
  assert.deepEqual(corsHeaders('https://a.example', ['https://a.example']), { 'access-control-allow-origin': 'https://a.example', 'access-control-expose-headers': 'Date', vary: 'Origin' });
  assert.deepEqual(corsHeaders('https://evil.example', ['https://a.example']), {});
  assert.deepEqual(corsHeaders(undefined, ['https://a.example']), {});
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('aspect ratio rejects zero components and link rejects non-string or >2048 chars', () => {
  assert.throws(() => validateEmbed({ options: { aspect: '0:9' } }), (e) => e.status === 422);
  assert.throws(() => validateEmbed({ options: { aspect: '16:0' } }), (e) => e.status === 422);
  assert.equal(validateEmbed({ options: { aspect: '4:5' } }).options.aspect, '4:5');
  assert.throws(() => validateItemText({ link: 123 }), (e) => e.status === 422);
  assert.throws(() => validateItemText({ link: `https://example.org/${'a'.repeat(2040)}` }), (e) => e.status === 422);
});

test('embed options: fitContent is opt-in, autoplay is opt-out', () => {
  assert.deepEqual(validateEmbed({}).options, { fit: 'contain', aspect: '16:9', dots: true, fitContent: false, autoplay: true });
  const o = validateEmbed({ options: { fitContent: true, autoplay: false } }).options;
  assert.equal(o.fitContent, true);
  assert.equal(o.autoplay, false);
});
