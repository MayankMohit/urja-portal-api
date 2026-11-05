import { describe, it, expect } from 'vitest';
import { sign } from '../src/portal/signing.js';

/**
 * Golden test for the export request signer.
 *
 * The expected value is NOT computed by this code. It was computed independently
 * in a browser with WebCrypto, using a FAKE secret ("test-secret", never the real
 * portal secret). That way the test proves our Node implementation matches the
 * portal's algorithm.
 *
 * The expected hex below was produced by running this in a browser console
 * (any browser), so it is an independent reference, not a self-check:
 *
 *   const enc = new TextEncoder();
 *   const key = await crypto.subtle.importKey(
 *     'raw', enc.encode('test-secret'),
 *     { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
 *   const msg = ['GET', '/portal/export', 'page=1', '1762318800'].join('\n');
 *   const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
 *   console.log([...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join(''));
 */

const FAKE_SECRET = 'test-secret';
const EXPECTED_HEX = '887b3350789ad393fd33ee99ba60a9042f419f0f5e01755c86adebe1bee88837';

describe('sign', () => {
  it('matches the browser-computed HMAC for the known vector', () => {
    const hex = sign('GET', '/portal/export', 'page=1', '1762318800', FAKE_SECRET);
    expect(hex).toBe(EXPECTED_HEX);
  });

  it('is deterministic and lowercase hex of length 64', () => {
    const a = sign('GET', '/portal/export', 'page=1', '1762318800', FAKE_SECRET);
    const b = sign('GET', '/portal/export', 'page=1', '1762318800', FAKE_SECRET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any part of the signed string changes', () => {
    const base = sign('GET', '/portal/export', 'page=1', '1762318800', FAKE_SECRET);
    expect(sign('GET', '/portal/export', 'page=2', '1762318800', FAKE_SECRET)).not.toBe(base);
    expect(sign('GET', '/portal/export', 'page=1', '1762318801', FAKE_SECRET)).not.toBe(base);
    expect(sign('POST', '/portal/export', 'page=1', '1762318800', FAKE_SECRET)).not.toBe(base);
  });
});
