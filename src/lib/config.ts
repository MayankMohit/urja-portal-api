
// Loads and validates configuration from the environment once at startup.
// Fails fast with a message if a required value is missing or invalid.

export interface Config {
  portalUrl: string;
  portalEmail: string;
  portalPassword: string;
  host: string;
  port: number;
  // Optional inbound API key.
  // if the API key is empty, API is open to all.
  apiKey?: string;
  // Defaults to 6 hours if not specified.
  syncIntervalHours: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  }
  return n;
}

export function loadConfig(): Config {
  const apiKey = process.env.API_KEY;
  return {
    portalUrl: (process.env.PORTAL_URL ?? 'https://urja-ops.flockenergy.tech').replace(/\/+$/, ''),
    portalEmail: required('PORTAL_EMAIL'),
    portalPassword: required('PORTAL_PASSWORD'),
    host: process.env.HOST ?? '127.0.0.1',
    port: optionalNumber('PORT', 3000),
    apiKey: apiKey === '' ? undefined : apiKey,
    syncIntervalHours: optionalNumber('SYNC_INTERVAL_HOURS', 6),
  };
}
