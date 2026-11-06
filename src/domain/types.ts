import type { RawExportMeter } from '../portal/types.js';

export type MeterStatus = 'installed' | 'faulty' | 'decommissioned';
export type PhaseType = 'single' | 'three';
export type InstallType = 'whole_current' | 'ct_operated';
export type Build = 'legacy' | 'v2';

export type IssueCode =
  | 'reading_invalid_timestamp'
  | 'reading_unparseable_value'
  | 'reading_unsorted'
  | 'reading_duplicate_timestamp'
  | 'register_decrease'
  | 'reading_gap'
  | 'meter_unknown_enum'
  | 'hierarchy_value_repaired'
  | 'hierarchy_value_missing'
  | 'dt_name_mismatch'
  | 'readings_stale'
  | 'readings_unavailable';

export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueEntityType = 'meter' | 'transformer' | 'reading';

export interface DataQualityIssue {
  code: IssueCode;
  severity: IssueSeverity;
  entityType: IssueEntityType;
  entityId: string;
  field?: string;
  message: string;
  originalValue?: unknown;
  repairedValue?: unknown;
}

export interface NormalizedReading {
  timestamp: string; 
  kwhRegister: number | null;
  kvahRegister: number | null;
  voltageR: number | null;
  kwh: number | null;
  kvah: number | null;
  powerFactor: number | null;
  gapBefore: boolean;
}

export interface NormalizedReadings {
  readings: NormalizedReading[];
  intervalMinutes: number | null;
  issues: DataQualityIssue[];
}

export interface NormalizedMeter {
  meterId: string;
  serialNo: string;
  make: string;
  phase: PhaseType;
  status: MeterStatus;
  installType: InstallType;
  build: Build;
  dtCode: string;
  geo: { lat: number; lng: number };
  rawHierarchy: RawExportMeter['hierarchy'];
}

export interface NormalizedMeterResult {
  meter: NormalizedMeter;
  issues: DataQualityIssue[];
}

export type HierarchyLevel =
  | 'zone'
  | 'circle'
  | 'division'
  | 'subdivision'
  | 'substation'
  | 'feeder'
  | 'dt';

export const HIERARCHY_LEVELS: HierarchyLevel[] = [
  'zone',
  'circle',
  'division',
  'subdivision',
  'substation',
  'feeder',
  'dt',
];

export interface NetworkPathNode {
  level: HierarchyLevel;
  id: string;
  code: string | null;
  name: string | null;
  repaired?: boolean;
}

export interface NetworkTreeNode {
  id: string;
  level: HierarchyLevel;
  code: string | null;
  name: string | null;
  meterCount: number;
  children: NetworkTreeNode[];
}

export interface NormalizedTransformer {
  code: string;
  name: string;
  aliases: string[];
  feederCode: string;
  capacityKva: number;
  meterCount: number;
  networkPath?: NetworkPathNode[];
}

export interface NetworkModel {
  meterPaths: Map<string, NetworkPathNode[]>;
  transformers: NormalizedTransformer[];
  tree: NetworkTreeNode[];
  issues: DataQualityIssue[];
}
