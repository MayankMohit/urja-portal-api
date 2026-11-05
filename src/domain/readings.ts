/**
 * Normalizes one meter's raw energy series into clean, derived readings.
 *
 * The portal serves every value as a string, timestamps as "DD/MM/YYYY HH:mm"
 * with no timezone, and kwh/kvah as cumulative meter registers (not usage). This
 * turns that into typed numbers, ISO 8601 timestamps in IST, and per-interval
 * consumption, recording a DataQualityIssue for anything it had to change or drop
 * rather than guessing.
 *
 * Order of operations matters: timestamps are parsed first, then rows are sorted
 * and de-duplicated, and only the survivors have their numbers parsed. That way
 * the known defect (a duplicate final row with blank kwh/voltR on five meters)
 * is dropped before it can generate bogus "unparseable value" noise.
 */

import type { RawEnergy, RawEnergyReading } from '../portal/types.js';
import type { DataQualityIssue, NormalizedReading, NormalizedReadings } from './types.js';
import { makeIssue } from './issues.js';

// All portal timestamps are assumed to be IST (+05:30). See PROTOCOL.md: Indian
// utility, Jaipur coordinates, daily readings at local midnight, no offset given.
const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;
const TIMESTAMP_RE = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

// Parse "DD/MM/YYYY HH:mm" as an IST wall-clock time.
// Returns an ISO string (with +05:30) for output and a UTC epoch for sorting and
// diffing, or null if the string is not a real timestamp.
function parseIstTimestamp(raw: string): { iso: string; epochMs: number } | null {
  const m = TIMESTAMP_RE.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m as unknown as [string, string, string, string, string, string];
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(min);

  // Build the instant as if the wall-clock were UTC, then shift back by the IST
  // offset to get the true UTC epoch.
  const epochMs = Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * MS_PER_MINUTE;

  // Round-trip check rejects impossible dates like 32/13/2026 that the regex lets through.
  const back = new Date(epochMs + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day ||
    back.getUTCHours() !== hour ||
    back.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return { iso: `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`, epochMs };
}

// Parse a numeric string. Empty or non-numeric becomes null (the caller records
// an issue); note Number('') is 0, which is why the empty check comes first.
function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Parse a reading value, recording a reading_unparseable_value issue if it could
// not be parsed. Returns null on failure.
function numberOrIssue(
  raw: string,
  field: string,
  meterId: string,
  iso: string,
  issues: DataQualityIssue[],
): number | null {
  const n = parseNumber(raw);
  if (n === null) {
    const reason = raw.trim() === '' ? 'empty' : `unparseable ("${raw}")`;
    issues.push(
      makeIssue({
        code: 'reading_unparseable_value',
        severity: 'warning',
        entityType: 'reading',
        entityId: meterId,
        field,
        message: `${field} is ${reason} at ${iso}; set to null.`,
        originalValue: raw,
      }),
    );
  }
  return n;
}

function detectIntervalMinutes(epochMs: number[]): number | null {
  if (epochMs.length < 2) return null;
  const counts = new Map<number, number>();
  for (let i = 1; i < epochMs.length; i++) {
    const diff = Math.round((epochMs[i]! - epochMs[i - 1]!) / MS_PER_MINUTE);
    counts.set(diff, (counts.get(diff) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [diff, count] of counts) {
    if (count > bestCount) {
      best = diff;
      bestCount = count;
    }
  }
  return best;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function normalizeReadings(meterId: string, raw: RawEnergy): NormalizedReadings {
  const issues: DataQualityIssue[] = [];

  // 1. Parse timestamps only. Drop rows whose timestamp is unusable, keeping the
  //    raw string values for later so number parsing happens after de-duplication.
  type Row = { iso: string; epochMs: number; raw: RawEnergyReading };
  const rows: Row[] = [];
  for (const r of raw.data) {
    const ts = parseIstTimestamp(r.timestamp);
    if (!ts) {
      issues.push(
        makeIssue({
          code: 'reading_invalid_timestamp',
          severity: 'error',
          entityType: 'reading',
          entityId: meterId,
          field: 'timestamp',
          message: `Unparseable timestamp "${r.timestamp}"; reading dropped.`,
          originalValue: r.timestamp,
        }),
      );
      continue;
    }
    rows.push({ iso: ts.iso, epochMs: ts.epochMs, raw: r });
  }

  // 2. Flag (once) if the source was out of order, then sort chronologically.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.epochMs < rows[i - 1]!.epochMs) {
      issues.push(
        makeIssue({
          code: 'reading_unsorted',
          severity: 'warning',
          entityType: 'reading',
          entityId: meterId,
          message: 'Source readings were not in chronological order; sorted by timestamp.',
        }),
      );
      break;
    }
  }
  rows.sort((a, b) => a.epochMs - b.epochMs);

  // 3. Drop duplicate timestamps, keeping the first. This removes the known
  //    blank-value trailer row on the five nine-row meters before it can cause
  //    a reading_unparseable_value issue in step 4.
  const deduped: Row[] = [];
  for (const row of rows) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.epochMs === row.epochMs) {
      issues.push(
        makeIssue({
          code: 'reading_duplicate_timestamp',
          severity: 'warning',
          entityType: 'reading',
          entityId: meterId,
          field: 'timestamp',
          message: `Duplicate timestamp ${row.iso}; later row dropped, first kept.`,
          originalValue: row.raw,
        }),
      );
      continue;
    }
    deduped.push(row);
  }

  // 4. Parse numbers on the survivors.
  const parsed = deduped.map((row) => ({
    iso: row.iso,
    epochMs: row.epochMs,
    kwhRegister: numberOrIssue(row.raw.kwh, 'kwh', meterId, row.iso, issues),
    kvahRegister: numberOrIssue(row.raw.kvah, 'kvah', meterId, row.iso, issues),
    voltageR: numberOrIssue(row.raw.voltR, 'voltR', meterId, row.iso, issues),
  }));

  const intervalMinutes = detectIntervalMinutes(parsed.map((p) => p.epochMs));

  // 5. Build the output, deriving interval consumption from consecutive registers.
  const readings: NormalizedReading[] = parsed.map((p, i) => {
    if (i === 0) {
      return {
        timestamp: p.iso,
        kwhRegister: p.kwhRegister,
        kvahRegister: p.kvahRegister,
        voltageR: p.voltageR,
        kwh: null,
        kvah: null,
        powerFactor: null,
        gapBefore: false,
      };
    }

    const prev = parsed[i - 1]!;
    let kwh = diff(p.kwhRegister, prev.kwhRegister);
    if (kwh !== null && kwh < 0) {
      issues.push(
        makeIssue({
          code: 'register_decrease',
          severity: 'warning',
          entityType: 'reading',
          entityId: meterId,
          field: 'kwh',
          message: `kWh register fell from ${prev.kwhRegister} to ${p.kwhRegister} at ${p.iso}; interval set to null.`,
          originalValue: { previous: prev.kwhRegister, current: p.kwhRegister },
        }),
      );
      kwh = null;
    }

    let kvah = diff(p.kvahRegister, prev.kvahRegister);
    if (kvah !== null && kvah < 0) {
      issues.push(
        makeIssue({
          code: 'register_decrease',
          severity: 'warning',
          entityType: 'reading',
          entityId: meterId,
          field: 'kvah',
          message: `kVAh register fell from ${prev.kvahRegister} to ${p.kvahRegister} at ${p.iso}; interval set to null.`,
          originalValue: { previous: prev.kvahRegister, current: p.kvahRegister },
        }),
      );
      kvah = null;
    }

    // Gap: larger than the meter's own interval means a reading is missing before this one.
    let gapBefore = false;
    if (intervalMinutes && intervalMinutes > 0) {
      const gapMinutes = Math.round((p.epochMs - prev.epochMs) / MS_PER_MINUTE);
      if (gapMinutes > intervalMinutes) {
        gapBefore = true;
        issues.push(
          makeIssue({
            code: 'reading_gap',
            severity: 'info',
            entityType: 'reading',
            entityId: meterId,
            field: 'timestamp',
            message: `Gap of ${gapMinutes} min before ${p.iso} exceeds the ${intervalMinutes} min interval.`,
          }),
        );
      }
    }

    const roundedKwh = kwh === null ? null : round3(kwh);
    const roundedKvah = kvah === null ? null : round3(kvah);
    const powerFactor =
      roundedKwh !== null && roundedKvah !== null && roundedKwh > 0 && roundedKvah > 0
        ? round3(roundedKwh / roundedKvah)
        : null;

    return {
      timestamp: p.iso,
      kwhRegister: p.kwhRegister,
      kvahRegister: p.kvahRegister,
      voltageR: p.voltageR,
      kwh: roundedKwh,
      kvah: roundedKvah,
      powerFactor,
      gapBefore,
    };
  });

  return { readings, intervalMinutes, issues };
}

// Difference between two register values, or null if either is missing.
function diff(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}
