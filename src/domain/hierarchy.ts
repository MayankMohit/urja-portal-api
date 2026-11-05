import type { RawDt, RawExportMeter } from '../portal/types.js';
import type {
  DataQualityIssue,
  HierarchyLevel,
  NetworkModel,
  NetworkPathNode,
  NetworkTreeNode,
  NormalizedTransformer,
} from './types.js';
import { HIERARCHY_LEVELS } from './types.js';
import { makeIssue } from './issues.js';
import { normalizeTransformers } from './transformers.js';

// The most common non-blank value in a list, or null if every value is blank.
function mostCommonNonBlank(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = v.trim();
    if (t === '') continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

interface LevelValue {
  code: string | null;
  name: string | null;
}
type DtCanonical = Record<HierarchyLevel, LevelValue>;

export function buildNetwork(meters: RawExportMeter[], dts: RawDt[]): NetworkModel {
  const issues: DataQualityIssue[] = [];
  const transformers = normalizeTransformers(dts);
  const dtsByCode = new Map(dts.map((d) => [d.code, d]));

  // Group meters by their transformer (the anchor). dtCode always equals
  // hierarchy.dt.code, so this is also a grouping by the bottom of the path.
  const byDt = new Map<string, RawExportMeter[]>();
  for (const m of meters) {
    const group = byDt.get(m.dtCode);
    if (group) group.push(m);
    else byDt.set(m.dtCode, [m]);
  }

  // 1. Per DT, compute the canonical (most common non-blank) code and name at
  //    each level, then override the DT name with the authoritative DT list and
  //    record any differing export name as an alias.
  const canonicalByDt = new Map<string, DtCanonical>();
  const aliasesByDt = new Map<string, string[]>();
  for (const [dtCode, group] of byDt) {
    const canonical = {} as DtCanonical;
    for (const level of HIERARCHY_LEVELS) {
      canonical[level] = {
        code: mostCommonNonBlank(group.map((m) => m.hierarchy[level].code)),
        name: mostCommonNonBlank(group.map((m) => m.hierarchy[level].name)),
      };
    }

    const authoritative = dtsByCode.get(dtCode);
    if (authoritative) {
      const exportNames = new Set(
        group
          .map((m) => m.hierarchy.dt.name.trim())
          .filter((n) => n !== '' && n !== authoritative.name),
      );
      const aliases = [...exportNames];
      canonical.dt.name = authoritative.name;
      aliasesByDt.set(dtCode, aliases);
      if (aliases.length > 0) {
        issues.push(
          makeIssue({
            code: 'dt_name_mismatch',
            severity: 'info',
            entityType: 'transformer',
            entityId: dtCode,
            field: 'name',
            message: `Export breadcrumb name(s) ${aliases.map((a) => `"${a}"`).join(', ')} differ from the DT list name "${authoritative.name}"; kept the DT list name, recorded the other(s) as aliases.`,
            originalValue: aliases,
            repairedValue: authoritative.name,
          }),
        );
      }
    }

    canonicalByDt.set(dtCode, canonical);
  }

  // 2. Build each meter's path, filling blanks from the DT canonical and marking
  //    what was repaired or is still missing. The node id is the running join of
  //    codes, so it is unique even when codes repeat under different parents.
  const meterPaths = new Map<string, NetworkPathNode[]>();
  for (const meter of meters) {
    const canonical = canonicalByDt.get(meter.dtCode)!;
    const path: NetworkPathNode[] = [];
    const codeSegments: string[] = [];

    for (const level of HIERARCHY_LEVELS) {
      const raw = meter.hierarchy[level];
      const canon = canonical[level];
      let repaired = false;

      // Code: use the meter's own value, else repair from the DT canonical.
      let code: string | null;
      if (raw.code.trim() === '') {
        if (canon.code !== null) {
          code = canon.code;
          repaired = true;
          issues.push(repairIssue(meter.meterId, level, 'code', canon.code));
        } else {
          code = null;
          issues.push(missingIssue(meter.meterId, level, 'code'));
        }
      } else {
        code = raw.code.trim();
      }

      // Name: the DT name is authoritative from the DT list; other levels use
      // the meter's own value, repaired from the canonical when blank.
      let name: string | null;
      if (level === 'dt') {
        name = canon.name;
      } else if (raw.name.trim() === '') {
        if (canon.name !== null) {
          name = canon.name;
          repaired = true;
          issues.push(repairIssue(meter.meterId, level, 'name', canon.name));
        } else {
          name = null;
          issues.push(missingIssue(meter.meterId, level, 'name'));
        }
      } else {
        name = raw.name.trim();
      }

      codeSegments.push(code ?? '');
      const node: NetworkPathNode = {
        level,
        id: codeSegments.join('/'),
        code,
        name,
      };
      if (repaired) node.repaired = true;
      path.push(node);
    }

    meterPaths.set(meter.meterId, path);
  }

  // 3. Enrich transformers with meter counts, aliases, and their zone..feeder path.
  for (const t of transformers) {
    t.meterCount = byDt.get(t.code)?.length ?? 0;
    t.aliases = aliasesByDt.get(t.code) ?? [];
    const sample = byDt.get(t.code)?.[0];
    if (sample) {
      // Any meter's path shares the DT's position; take zone..feeder (drop the DT itself).
      t.networkPath = meterPaths.get(sample.meterId)!.slice(0, HIERARCHY_LEVELS.length - 1);
    }
  }

  // 4. Aggregate the tree: every meter path contributes one count to each node
  //    it passes through. Parent links come from the path order.
  const tree = buildTree(meterPaths);

  return { meterPaths, transformers, tree, issues };
}

function repairIssue(
  meterId: string,
  level: HierarchyLevel,
  field: 'code' | 'name',
  repairedValue: string,
): DataQualityIssue {
  return makeIssue({
    code: 'hierarchy_value_repaired',
    severity: 'info',
    entityType: 'meter',
    entityId: meterId,
    field: `${level}.${field}`,
    message: `${level} ${field} was blank at source; repaired to "${repairedValue}" from sibling meters on the same DT.`,
    originalValue: '',
    repairedValue,
  });
}

function missingIssue(meterId: string, level: HierarchyLevel, field: 'code' | 'name'): DataQualityIssue {
  return makeIssue({
    code: 'hierarchy_value_missing',
    severity: 'warning',
    entityType: 'meter',
    entityId: meterId,
    field: `${level}.${field}`,
    message: `${level} ${field} was blank at source and no sibling meter on the same DT had it; left null.`,
    originalValue: '',
  });
}

function buildTree(meterPaths: Map<string, NetworkPathNode[]>): NetworkTreeNode[] {
  const nodes = new Map<string, NetworkTreeNode>();
  const parentOf = new Map<string, string>();

  for (const path of meterPaths.values()) {
    for (let i = 0; i < path.length; i++) {
      const step = path[i]!;
      let node = nodes.get(step.id);
      if (!node) {
        node = { id: step.id, level: step.level, code: step.code, name: step.name, meterCount: 0, children: [] };
        nodes.set(step.id, node);
      }
      node.meterCount++;
      if (i > 0) parentOf.set(step.id, path[i - 1]!.id);
    }
  }

  const roots: NetworkTreeNode[] = [];
  for (const [id, node] of nodes) {
    const parentId = parentOf.get(id);
    if (parentId) nodes.get(parentId)!.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (list: NetworkTreeNode[]): void => {
    list.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '') || a.id.localeCompare(b.id));
    for (const n of list) sortNodes(n.children);
  };
  sortNodes(roots);

  return roots;
}
