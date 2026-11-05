/**
 * Raw portal response types, exactly as the portal returns them.
 *
 * Deliberately faithful to the wire: energy values are strings, numbers that
 * arrive as strings stay strings, and nothing is renamed. All cleanup happens
 * later in the domain layer. This keeps the portal client dumb and the
 * normalization rules in one place.
 */

// One hierarchy node as embedded in an export record. Values can be "" (blank at source).
export interface RawHierarchyNode {
  name: string;
  code: string;
}

// A single meter record from GET /portal/export (PROTOCOL.md section 7).
export interface RawExportMeter {
  meterId: string;
  serialNo: string;
  make: string;
  phaseType: string;
  installStatus: string;
  installType: string;
  build: string;
  dtCode: string;
  hierarchy: {
    zone: RawHierarchyNode;
    circle: RawHierarchyNode;
    division: RawHierarchyNode;
    subdivision: RawHierarchyNode;
    substation: RawHierarchyNode;
    feeder: RawHierarchyNode;
    dt: RawHierarchyNode;
  };
  geo: { lat: number; lng: number };
}

// Full export envelope. `page` is ignored by the portal; we always get all meters.
export interface RawExport {
  data: RawExportMeter[];
  total: number;
}

// A transformer row from GET /portal/dts.
export interface RawDt {
  code: string;
  name: string;
  feederCode: string;
  capacityKva: number;
}

// One paged response from GET /portal/dts?page=N.
export interface RawDtsPage {
  data: RawDt[];
  total: number;
}

// One energy reading. Every field is a string; formatting is inconsistent.
export interface RawEnergyReading {
  timestamp: string;
  kwh: string;
  kvah: string;
  voltR: string;
}

// Full energy response from GET /portal/meters/{id}/energy. No query params.
export interface RawEnergy {
  data: RawEnergyReading[];
}

// GET /portal/keys. Never persisted or logged.
export interface RawKeys {
  data: { signingSecret: string };
}

// Error body shape shared by /portal/* failures.
export interface PortalErrorBody {
  error?: string;
  message?: string;
}
