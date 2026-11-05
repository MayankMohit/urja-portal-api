import type { Config } from '../lib/config.js';
import { sign } from './signing.js';
import {
  PortalAuthError,
  PortalHttpError,
  PortalLoginError,
  PortalSignatureError,
  PortalTimeoutError,
} from './errors.js';
import type {
  PortalErrorBody,
  RawDt,
  RawDtsPage,
  RawEnergy,
  RawExport,
  RawKeys,
} from './types.js';

// Minimal logger shape, compatible with pino (Fastify's logger).
export interface PortalLogger {
  debug(obj: Record<string, unknown>, msg?: string): void;
}
const noopLogger: PortalLogger = { debug() {} };

const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';
// Re-login proactively every 55 minutes before the 1hr expiry.
const SESSION_MAX_AGE_MS = 55 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

/**
 * The only code that knows the portal exists. Everything above it (sync, scripts)
 * calls these methods and gets clean raw types back; portal quirks (two 401s,
 * signing, session expiry, transient errors) are handled here.
 */
export class PortalClient {
  private cookie: string | null = null;
  private loggedInAt: number | null = null;
  // Shared in-flight login so concurrent callers don't each log in (single-flight).
  private loginPromise: Promise<void> | null = null;
  // Global signing secret, cached for the process lifetime; refreshed on signature_invalid.
  private secret: string | null = null;
  // Correction applied to our clock when it drifts from the server's Date header.
  private clockOffsetSeconds = 0;
  private readonly logger: PortalLogger;

  constructor(private readonly config: Config, logger: PortalLogger = noopLogger) {
    this.logger = logger;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  // Log in and store the session cookie. Single-flight: concurrent calls share one login.
  async login(): Promise<void> {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.doLogin().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  // GET a /portal/* JSON endpoint that needs only a session. Re-logs in once on `unauthorized`.
  async getJson<T>(path: string): Promise<T> {
    await this.ensureSession();
    let res = await this.fetchRaw('GET', path, '', undefined, () => this.authHeaders());

    if (res.status === 401) {
      const body = await this.readErrorBody(res);
      // The only 401 an unsigned endpoint returns is `unauthorized`: session is gone.
      this.clearSession();
      await this.login();
      res = await this.fetchRaw('GET', path, '', undefined, () => this.authHeaders());
      if (res.status === 401) {
        throw new PortalAuthError(
          `Still unauthorized after re-login: GET ${path} (${body?.error ?? 'unknown'})`,
        );
      }
    }
    return this.parseJson<T>(res, 'GET', path);
  }

  // Fetch the global signing secret, cached after the first call. Never logged or persisted.
  async getSigningSecret(): Promise<string> {
    if (this.secret) return this.secret;
    const keys = await this.getJson<RawKeys>('/portal/keys');
    this.secret = keys.data.signingSecret;
    return this.secret;
  }

  /**
   * GET a signed /portal/* endpoint (currently only /portal/export). Reacts to the
   * two different 401s: `signature_invalid` means re-sign (do NOT log in);
   * `unauthorized` means the session died, so log in. Each is retried once.
   */
  async getSignedJson<T>(path: string, query: string): Promise<T> {
    await this.ensureSession();
    await this.getSigningSecret();

    // Re-run per network attempt so every attempt carries a fresh timestamp + signature.
    const buildHeaders = (): Record<string, string> => {
      const ts = String(Math.floor(Date.now() / 1000) + this.clockOffsetSeconds);
      return {
        ...this.authHeaders(),
        'x-timestamp': ts,
        'x-signature': sign('GET', path, query, ts, this.secret!),
      };
    };

    let res = await this.fetchRaw('GET', path, query, undefined, buildHeaders);

    if (res.status === 401) {
      const body = await this.readErrorBody(res);
      if (body?.error === 'signature_invalid') {
        // Signature problem, not a session problem. Adjust for clock skew, drop the
        // cached secret, re-fetch it, and let buildHeaders re-sign on the retry.
        this.maybeAdjustClock(res);
        this.secret = null;
        await this.getSigningSecret();
      } else {
        // `unauthorized`: the session expired mid-call. Log in again.
        this.clearSession();
        await this.login();
      }

      res = await this.fetchRaw('GET', path, query, undefined, buildHeaders);
      if (res.status === 401) {
        const body2 = await this.readErrorBody(res);
        if (body2?.error === 'signature_invalid') {
          throw new PortalSignatureError(`Signature still invalid after re-sign: GET ${path}?${query}`);
        }
        throw new PortalAuthError(`Still unauthorized after re-login: GET ${path}?${query}`);
      }
    }
    return this.parseJson<T>(res, 'GET', `${path}?${query}`);
  }

  // The signed bulk export: all 403 meters in one request. `page` is ignored by the portal.
  async getExport(): Promise<RawExport> {
    return this.getSignedJson<RawExport>('/portal/export', 'page=1');
  }

  // All transformers, looping pages until we've collected `total` rows.
  async getTransformers(): Promise<RawDt[]> {
    const all: RawDt[] = [];
    let page = 1;
    let total = Infinity;
    while (all.length < total) {
      const res = await this.getJson<RawDtsPage>(`/portal/dts?page=${page}`);
      total = res.total;
      all.push(...res.data);
      // Safety valve: stop if a page comes back empty so we never loop forever.
      if (res.data.length === 0) break;
      page++;
    }
    return all;
  }

  // One meter's energy readings. The endpoint takes no query params.
  async getEnergy(meterId: string): Promise<RawEnergy> {
    return this.getJson<RawEnergy>(`/portal/meters/${encodeURIComponent(meterId)}/energy`);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async doLogin(): Promise<void> {
    const body = new URLSearchParams({
      email: this.config.portalEmail,
      password: this.config.portalPassword,
    }).toString();

    const res = await this.fetchRaw('POST', '/login', '', body, () => ({
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      // SvelteKit's CSRF protection: the login fails with 403 without this.
      Origin: this.config.portalUrl,
    }));

    const text = await res.text();
    let parsed: { type?: string; status?: number; data?: unknown } | undefined;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    // The portal returns HTTP 200 even for a wrong password, so the body `type`
    // is the real signal, not the HTTP status (PROTOCOL.md section 3).
    if (res.status !== 200 || parsed?.type !== 'redirect') {
      const detail = this.decodeLoginFailure(parsed?.data);
      throw new PortalLoginError(
        `Login failed (http ${res.status}${parsed?.status ? `, portal ${parsed.status}` : ''})` +
          (detail ? `: ${detail}` : ''),
        { portalStatus: parsed?.status },
      );
    }

    const cookie = this.extractSessionCookie(res);
    if (!cookie) {
      throw new PortalLoginError('Login reported success but no session cookie was set');
    }
    this.cookie = cookie;
    this.loggedInAt = Date.now();
  }

  // Log in if we have no cookie or the current one is close to the hard expiry.
  private async ensureSession(): Promise<void> {
    const age = this.loggedInAt ? Date.now() - this.loggedInAt : Infinity;
    if (!this.cookie || age > SESSION_MAX_AGE_MS) {
      await this.login();
    }
  }

  private clearSession(): void {
    this.cookie = null;
    this.loggedInAt = null;
  }

  private authHeaders(): Record<string, string> {
    return this.cookie ? { cookie: this.cookie } : {};
  }

  /**
   * One fetch with transient-failure retries (429, 5xx, network, timeout).
   * Headers are rebuilt per attempt so signed requests re-sign every time.
   * Non-transient responses (incl. 401/404/400) are returned for the caller to handle.
   */
  private async fetchRaw(
    method: string,
    path: string,
    query: string,
    body: string | undefined,
    buildHeaders: () => Record<string, string>,
  ): Promise<Response> {
    const url = `${this.config.portalUrl}${path}${query ? `?${query}` : ''}`;
    const logPath = `${path}${query ? `?${query}` : ''}`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        const res = await fetch(url, {
          method,
          body,
          headers: buildHeaders(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        this.logger.debug(
          { method, path: logPath, status: res.status, ms: Date.now() - started, attempt },
          'portal request',
        );

        if (res.status === 429) {
          // Rate limited. Log what the portal tells us about the window, then only
          // retry here if it gave an explicit Retry-After. Otherwise return the 429
          // immediately: hammering a rate limit is both rude and useless, so bulk
          // recovery is handled by the caller's cooldown passes (see fetchEnergy).
          const retryAfter = res.headers.get('retry-after');
          this.logger.debug(
            {
              path: logPath,
              retryAfter,
              remaining: res.headers.get('x-ratelimit-remaining'),
              reset: res.headers.get('x-ratelimit-reset'),
            },
            'portal rate-limited',
          );
          if (retryAfter && attempt < MAX_ATTEMPTS) {
            await this.backoff(attempt, retryAfter);
            continue;
          }
          return res;
        }
        if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
          await this.backoff(attempt, res.headers.get('retry-after'));
          continue;
        }
        return res;
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        this.logger.debug(
          { method, path: logPath, error: isTimeout ? 'timeout' : 'network', attempt },
          'portal request failed',
        );
        if (attempt < MAX_ATTEMPTS) {
          await this.backoff(attempt, null);
          continue;
        }
        if (isTimeout) {
          throw new PortalTimeoutError(`Timed out after ${MAX_ATTEMPTS} attempts: ${method} ${logPath}`, {
            cause: err,
          });
        }
        throw new PortalHttpError(0, `Network error after ${MAX_ATTEMPTS} attempts: ${method} ${logPath}`, {
          cause: err,
        });
      }
    }
    // Unreachable: the loop always returns or throws on the last attempt.
    throw new PortalHttpError(0, `Exhausted retries: ${method} ${logPath}`);
  }

  // Exponential backoff (1s, 2s, 4s...) with jitter; honours Retry-After if larger.
  private async backoff(attempt: number, retryAfter: string | null): Promise<void> {
    let delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) delayMs = Math.max(delayMs, secs * 1000);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs + Math.random() * 250));
  }

  private async parseJson<T>(res: Response, method: string, logPath: string): Promise<T> {
    if (res.status < 200 || res.status >= 300) {
      const body = await this.readErrorBody(res);
      throw new PortalHttpError(
        res.status,
        `${method} ${logPath} failed: ${res.status} ${body?.error ?? body?.message ?? ''}`.trim(),
      );
    }
    return (await res.json()) as T;
  }

  // Read an error body without consuming the original response (uses a clone).
  private async readErrorBody(res: Response): Promise<PortalErrorBody | undefined> {
    try {
      return (await res.clone().json()) as PortalErrorBody;
    } catch {
      return undefined;
    }
  }

  private extractSessionCookie(res: Response): string | null {
    for (const setCookie of res.headers.getSetCookie()) {
      const nameValue = setCookie.split(';', 1)[0]; // keep only `name=value`
      if (nameValue.startsWith(`${SESSION_COOKIE_NAME}=`)) {
        return nameValue;
      }
    }
    return null;
  }

  /**
   * Decode the devalue-encoded login failure `data` to a human message.
   * Shape: a flat array where index 0 is the root object whose `error` field is
   * an index into the same array (PROTOCOL.md section 3). Best-effort only.
   */
  private decodeLoginFailure(data: unknown): string | undefined {
    if (typeof data !== 'string') return undefined;
    try {
      const arr = JSON.parse(data);
      if (Array.isArray(arr) && arr[0] && typeof arr[0] === 'object') {
        const ref = (arr[0] as Record<string, unknown>).error;
        if (typeof ref === 'number' && typeof arr[ref] === 'string') {
          return arr[ref];
        }
      }
    } catch {
      // Not decodable; the caller still reports the HTTP/portal status.
    }
    return undefined;
  }

  // If the server's Date header differs from our clock by > 60s, correct for it when signing.
  private maybeAdjustClock(res: Response): void {
    const dateHeader = res.headers.get('date');
    if (!dateHeader) return;
    const serverMs = Date.parse(dateHeader);
    if (!Number.isFinite(serverMs)) return;
    const offsetSeconds = Math.round((serverMs - Date.now()) / 1000);
    if (Math.abs(offsetSeconds) > 60) {
      this.clockOffsetSeconds = offsetSeconds;
    }
  }
}
