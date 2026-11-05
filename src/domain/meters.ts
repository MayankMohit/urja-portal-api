import type { RawExportMeter } from '../portal/types.js';
import type {
  Build,
  DataQualityIssue,
  InstallType,
  MeterStatus,
  NormalizedMeter,
  NormalizedMeterResult,
  PhaseType,
} from './types.js';

const STATUS_MAP: Record<string, MeterStatus> = {
  Installed: 'installed',
  Faulty: 'faulty',
  Decommissioned: 'decommissioned',
};
const PHASE_MAP: Record<string, PhaseType> = {
  single: 'single',
  three: 'three',
};
const INSTALL_TYPE_MAP: Record<string, InstallType> = {
  'Whole Current': 'whole_current',
  'CT Operated': 'ct_operated',
};
const BUILD_MAP: Record<string, Build> = {
  legacy: 'legacy',
  v2: 'v2',
};

function mapEnum<T extends string>(
  raw: string,
  map: Record<string, T>,
  field: string,
  meterId: string,
  issues: DataQualityIssue[],
): T {
  const mapped = map[raw.trim()];
  if (mapped === undefined) {
    issues.push({
      code: 'meter_unknown_enum',
      severity: 'warning',
      entityType: 'meter',
      entityId: meterId,
      field,
      message: `Unknown ${field} "${raw}"; passed through unmapped.`,
      originalValue: raw,
    });
    return raw.trim() as T;
  }
  return mapped;
}

export function normalizeMeter(raw: RawExportMeter): NormalizedMeterResult {
  const issues: DataQualityIssue[] = [];
  const meter: NormalizedMeter = {
    meterId: raw.meterId,
    serialNo: raw.serialNo,
    make: raw.make,
    phase: mapEnum(raw.phaseType, PHASE_MAP, 'phaseType', raw.meterId, issues),
    status: mapEnum(raw.installStatus, STATUS_MAP, 'installStatus', raw.meterId, issues),
    installType: mapEnum(raw.installType, INSTALL_TYPE_MAP, 'installType', raw.meterId, issues),
    build: mapEnum(raw.build, BUILD_MAP, 'build', raw.meterId, issues),
    dtCode: raw.dtCode,
    geo: { lat: raw.geo.lat, lng: raw.geo.lng },
    rawHierarchy: raw.hierarchy,
  };
  return { meter, issues };
}
