import type { RawDt } from '../portal/types.js';
import type { NormalizedTransformer } from './types.js';

export function normalizeTransformer(raw: RawDt): NormalizedTransformer {
  return {
    code: raw.code,
    name: raw.name,
    aliases: [],
    feederCode: raw.feederCode,
    capacityKva: raw.capacityKva,
    meterCount: 0,
  };
}

export function normalizeTransformers(raws: RawDt[]): NormalizedTransformer[] {
  return raws.map(normalizeTransformer);
}
