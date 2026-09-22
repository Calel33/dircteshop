import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSafeExternalUrl } from './utils.ts';

test('accepts absolute http(s) URLs', () => {
  assert.equal(isSafeExternalUrl('https://example.com'), true);
  assert.equal(isSafeExternalUrl('http://example.com'), true);
});

test('rejects non-http(s) URL schemes', () => {
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeExternalUrl('vbscript:msgbox(1)'), false);
});

test('rejects protocol-relative URLs', () => {
  assert.equal(isSafeExternalUrl('//example.com'), false);
});

test('rejects scheme look-alikes with leading whitespace', () => {
  assert.equal(isSafeExternalUrl(' javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('\thttps://example.com'), false);
});

test('rejects empty and nullish values', () => {
  assert.equal(isSafeExternalUrl(''), false);
  assert.equal(isSafeExternalUrl(undefined), false);
  assert.equal(isSafeExternalUrl(null), false);
});
