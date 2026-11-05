import { createHmac } from 'node:crypto';

/**
 * Reproduces the portal's export request signing.
 *
 * The string to sign is the four parts joined by newlines, in this exact order:
 *   method, path, query, timestamp
 * for example: "GET\n/portal/export\npage=1\n1762318800".
 *
 * Notes that are easy to get wrong:
 * - `query` has NO leading "?" (e.g. "page=1", not "?page=1").
 * - `timestamp` is Unix SECONDS as a string, not milliseconds.
 * - the result is lowercase hex (Node's digest('hex') is already lowercase).
 */

export function sign(
  method: string,
  path: string,
  query: string,
  timestamp: string,
  secret: string,
): string {
  const message = [method, path, query, timestamp].join('\n');
  return createHmac('sha256', secret).update(message).digest('hex');
}
