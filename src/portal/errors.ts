/**
 * Each subclass maps to a distinct failure mode so callers (sync, scripts) can
 * react differently. The two that matter most are PortalAuthError (session is
 * gone, log in again) and PortalSignatureError (signature was rejected, re-sign
 * but do NOT log in).
*/

// Base class so callers can `catch (e) { if (e instanceof PortalError) ... }`.
export class PortalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Login did not succeed (wrong password, missing Origin, unexpected body).
export class PortalLoginError extends PortalError {
  // The portal's own status field when it returned a failure body (e.g. 401, 403).
  readonly portalStatus?: number;
  constructor(message: string, options?: { cause?: unknown; portalStatus?: number }) {
    super(message, options);
    this.portalStatus = options?.portalStatus;
  }
}

// A /portal/* call returned 401 `unauthorized` and re-login did not fix it.
export class PortalAuthError extends PortalError {}

// A signed call returned 401 `signature_invalid` and re-signing did not fix it.
export class PortalSignatureError extends PortalError {}

// Any other non-2xx response we don't handle specifically.
export class PortalHttpError extends PortalError {
  readonly status: number;
  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}

// A request exceeded its timeout (AbortSignal.timeout fired).
export class PortalTimeoutError extends PortalError {}