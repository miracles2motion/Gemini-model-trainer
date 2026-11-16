import { TEAM_STAT_FIELDS } from './courtquantEngine.ts';
import type { AuditInspectionSummary, SchemaFieldSummary, TeamStats } from './courtquantTypes.ts';

function inferType(val: unknown): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return `array(${val.length})`;
  return typeof val;
}

export function resolveSchema3Refs(
  node: unknown,
  defs: Record<string, unknown>,
  depth = 0,
): unknown {
  if (depth > 8 || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map((item) => resolveSchema3Refs(item, defs, depth + 1));
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === 'string' && defs[obj.$ref] !== undefined) {
    return resolveSchema3Refs(defs[obj.$ref], defs, depth + 1);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'definitions') continue;
    out[k] = resolveSchema3Refs(v, defs, depth + 1);
  }
  return out;
}

export function normalizeTeamStats(
  raw: Record<string, unknown> | undefined | null,
): TeamStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const gRaw = raw.games ?? raw.g;
  const g = Number(gRaw ?? 0);
  if (!Number.isFinite(g) || g <= 0) return null;

  const pts = Number(raw.totalPoints ?? raw.pts ?? 0);
  const opp_pts = Number(raw.opponentPoints ?? raw.opp_pts ?? 0);
  const fga = Number(raw.fieldGoalAttempts ?? raw.fga ?? 0);
  const fta = Number(raw.freeThrowAttempts ?? raw.fta ?? 0);
  const orb = Number(raw.offensiveRebounds ?? raw.orb ?? 0);
  const tov = Number(raw.turnovers ?? raw.tov ?? 0);
  const rawPace = (fga - orb + tov + 0.475 * fta) / g;
  const pace =
    typeof raw.pace === 'number' && Number.isFinite(raw.pace) && raw.pace >= 45 && raw.pace <= 95
      ? raw.pace
      : Number.isFinite(rawPace) && rawPace >= 45 && rawPace <= 95
        ? rawPace
        : 70;

  return {
    g,
    srs: typeof raw.srs === 'number' && Number.isFinite(raw.srs) ? raw.srs : null,
    sos: typeof raw.sos === 'number' && Number.isFinite(raw.sos) ? raw.sos : null,
    pts,
    opp_pts,
    pts_g: typeof raw.pts_g === 'number' ? raw.pts_g : pts / g,
    opp_g: typeof raw.opp_g === 'number' ? raw.opp_g : opp_pts / g,
    total_g: typeof raw.total_g === 'number' ? raw.total_g : (pts + opp_pts) / g,
    pace,
    fga,
    fta,
    orb,
    tov,
    mp: Number(raw.mp ?? g * 40),
    fg: Number(raw.fg ?? 0),
    fg3: Number(raw.fg3 ?? 0),
    fg3a: Number(raw.fg3a ?? 0),
    ft: Number(raw.ft ?? 0),
    opp_fg: Number(raw.oppFg ?? raw.opp_fg ?? 0),
    opp_fga: Number(raw.oppFga ?? raw.opp_fga ?? 0),
    opp_fg3: Number(raw.oppFg3 ?? raw.opp_fg3 ?? 0),
    opp_fg3a: Number(raw.oppFg3a ?? raw.opp_fg3a ?? 0),
    opp_ft: Number(raw.oppFt ?? raw.opp_ft ?? 0),
    opp_fta: Number(raw.oppFta ?? raw.opp_fta ?? 0),
    opp_orb: Number(raw.oppOrb ?? raw.opp_orb ?? 0),
    opp_tov: Number(raw.oppTov ?? raw.opp_tov ?? 0),
  };
}

function detectMappedTeamFields(
  rawObj: Record<string, unknown>,
  prefix: 'home' | 'away',
  targetSet: Set<string>,
): void {
  const normalized = normalizeTeamStats(rawObj);
  if (normalized) {
    for (const field of TEAM_STAT_FIELDS) {
      if (normalized[field] !== undefined) {
        targetSet.add(`${prefix}.${field}`);
      }
    }
    return;
  }
  for (const field of TEAM_STAT_FIELDS) {
    if (rawObj[field] !== undefined) {
      targetSet.add(`${prefix}.${field}`);
    }
  }
}

function collectSchemaFields(
  records: Record<string, unknown>[],
  maxDepth = 3,
  maxFields = 140,
): SchemaFieldSummary[] {
  const fieldMap = new Map<string, { types: Set<string>; count: number; sampleKeys?: Set<string> }>();

  function walk(obj: unknown, prefix: string, depth: number): void {
    if (fieldMap.size >= maxFields || depth > maxDepth || obj === null || typeof obj !== 'object') {
      return;
    }
    if (Array.isArray(obj)) {
      const entry = fieldMap.get(prefix) ?? { types: new Set<string>(), count: 0 };
      entry.types.add('array');
      entry.count += 1;
      fieldMap.set(prefix, entry);
      if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
        walk(obj[0], `${prefix}[]`, depth + 1);
      }
      return;
    }
    const record = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(record)) {
      if (k === 'definitions') continue;
      if (fieldMap.size >= maxFields) break;
      const path = prefix ? `${prefix}.${k}` : k;
      const entry = fieldMap.get(path) ?? { types: new Set<string>(), count: 0 };
      entry.types.add(inferType(v));
      entry.count += 1;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const subKeys = Object.keys(v as Record<string, unknown>);
        if (subKeys.length > 0 && subKeys.length <= 28) {
          entry.sampleKeys = entry.sampleKeys ?? new Set<string>();
          for (const sk of subKeys.slice(0, 14)) {
            entry.sampleKeys.add(sk);
          }
        }
      }
      fieldMap.set(path, entry);
      if (v && typeof v === 'object' && depth < maxDepth) {
        walk(v, path, depth + 1);
      }
    }
  }

  for (const rec of records.slice(0, 50)) {
    const defs =
      rec.definitions && typeof rec.definitions === 'object' && !Array.isArray(rec.definitions)
        ? (rec.definitions as Record<string, unknown>)
        : null;
    const resolved = defs ? resolveSchema3Refs(rec, defs, 0) : rec;
    walk(resolved, '', 0);
  }

  return Array.from(fieldMap.entries()).map(([path, info]) => ({
    path,
    types: Array.from(info.types),
    presentCount: info.count,
    sampleKeys: info.sampleKeys ? Array.from(info.sampleKeys) : undefined,
  }));
}

function findTeamObjectCandidates(record: Record<string, unknown>): {
  homeObj: Record<string, unknown> | null;
  awayObj: Record<string, unknown> | null;
} {
  const candidates: Array<[string, string]> = [
    ['home', 'away'],
    ['homeTeam', 'awayTeam'],
    ['homeStats', 'awayStats'],
    ['home_stats', 'away_stats'],
  ];
  for (const [hKey, aKey] of candidates) {
    const h = record[hKey];
    const a = record[aKey];
    if (h && typeof h === 'object' && a && typeof a === 'object') {
      return {
        homeObj: h as Record<string, unknown>,
        awayObj: a as Record<string, unknown>,
      };
    }
  }
  for (const nestedKey of [
    'analysis',
    'receipt',
    'payload',
    'teams',
    'stats',
    'input',
    'features',
    'snapshot',
    'fixture',
    'match',
  ]) {
    const nested = record[nestedKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const inner = findTeamObjectCandidates(nested as Record<string, unknown>);
      if (inner.homeObj && inner.awayObj) {
        return inner;
      }
    }
  }
  return { homeObj: null, awayObj: null };
}

function hasSettledOutcome(record: Record<string, unknown>): boolean {
  const directPairs: Array<[string, string]> = [
    ['homeScore', 'awayScore'],
    ['home_score', 'away_score'],
    ['finalHome', 'finalAway'],
    ['actualHome', 'actualAway'],
    ['homePts', 'awayPts'],
  ];
  for (const [hk, ak] of directPairs) {
    const hv = record[hk];
    const av = record[ak];
    if (typeof hv === 'number' && typeof av === 'number' && hv > 0 && av > 0) {
      const st = typeof record.status === 'string' ? record.status : '';
      if (!st || st === 'Ended' || st === 'AET' || st === 'post' || st === 'SETTLED') {
        return true;
      }
    }
  }
  for (const key of ['analysis', 'result', 'outcome', 'settlement', 'finalScore', 'score', 'actual']) {
    const sub = record[key];
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
      if (hasSettledOutcome(sub as Record<string, unknown>)) {
        return true;
      }
      const obj = sub as Record<string, unknown>;
      if (
        (typeof obj.home === 'number' && typeof obj.away === 'number') ||
        typeof obj.settled === 'boolean' ||
        typeof obj.winner === 'string'
      ) {
        return true;
      }
    }
  }
  if (record.settled === true || record.isSettled === true || record.status === 'SETTLED') {
    return true;
  }
  return false;
}

function extractFixtureId(record: Record<string, unknown>, idx: number): string {
  for (const key of [
    'fixtureKey',
    'fixtureId',
    'fixture_id',
    'eventId',
    'matchId',
    'match_id',
    'gameId',
    'id',
  ]) {
    const val = record[key];
    if (typeof val === 'string' || typeof val === 'number') {
      return String(val);
    }
  }
  for (const nested of ['analysis', 'fixture']) {
    const sub = record[nested];
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
      const obj = sub as Record<string, unknown>;
      if (obj.eventId !== undefined) return String(obj.eventId);
      if (obj.fixtureId !== undefined) return String(obj.fixtureId);
      if (obj.id !== undefined) return String(obj.id);
    }
  }
  return `row-${idx}`;
}

function extractIsoTimestamp(record: Record<string, unknown>): string | null {
  for (const key of [
    'kickoffIso',
    'startTime',
    'commenceTime',
    'capturedAtIso',
    'capturedAt',
    'createdAt',
    'date',
    'timestamp',
    'epochMs',
  ]) {
    const v = record[key];
    if (typeof v === 'string' && v.length >= 8) {
      const parsed = Date.parse(v);
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    }
    if (typeof v === 'number' && v > 1_000_000_000) {
      const ms = v < 10_000_000_000 ? v * 1000 : v;
      return new Date(ms).toISOString();
    }
  }
  for (const nested of ['analysis', 'receipt', 'payload']) {
    const sub = record[nested];
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
      const iso = extractIsoTimestamp(sub as Record<string, unknown>);
      if (iso) return iso;
    }
  }
  return null;
}

export function inspectAuditPayload(
  rawData: unknown,
  fileName: string,
  fileSizeBytes: number,
): AuditInspectionSummary {
  const warnings: string[] = [];

  if (rawData === null || typeof rawData !== 'object') {
    throw new Error('Audit JSON root must be an object or array');
  }

  let topLevelKeys: string[] = [];
  let schemaVersion: number | string | null = null;
  const headerMetadata: Record<string, string | number | boolean | null> = {};
  const definitionTableKeys: string[] = [];
  let definitionCount = 0;
  let recordCollectionKey: string | null = null;
  let records: Record<string, unknown>[] = [];
  let rootDefs: Record<string, unknown> = {};

  if (Array.isArray(rawData)) {
    topLevelKeys = ['<root-array>'];
    recordCollectionKey = '<root-array>';
    records = rawData.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
  } else {
    const root = rawData as Record<string, unknown>;
    topLevelKeys = Object.keys(root);

    if (typeof root.schemaVersion === 'number' || typeof root.schemaVersion === 'string') {
      schemaVersion = root.schemaVersion;
    } else if (typeof root.schema === 'number' || typeof root.schema === 'string') {
      schemaVersion = root.schema;
    } else if (typeof root.version === 'number' || typeof root.version === 'string') {
      schemaVersion = root.version;
    }

    for (const k of topLevelKeys) {
      const v = root[k];
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        headerMetadata[k] = v;
      }
    }

    for (const defKey of ['definitions', 'hashes', 'contentHashes', 'recipes', 'schemas', 'models', 'dictionaries']) {
      const maybeDefs = root[defKey];
      if (maybeDefs && typeof maybeDefs === 'object') {
        definitionTableKeys.push(defKey);
        if (Array.isArray(maybeDefs)) {
          definitionCount += maybeDefs.length;
        } else {
          definitionCount += Object.keys(maybeDefs as Record<string, unknown>).length;
          if (defKey === 'definitions') {
            rootDefs = maybeDefs as Record<string, unknown>;
          }
        }
      }
    }

    const preferredRecordKeys = [
      'records',
      'selections',
      'fixtures',
      'captures',
      'entries',
      'games',
      'items',
      'rows',
      'data',
    ];
    for (const rk of preferredRecordKeys) {
      if (Array.isArray(root[rk])) {
        recordCollectionKey = rk;
        records = (root[rk] as unknown[]).filter(
          (x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'),
        );
        break;
      }
    }

    if (!recordCollectionKey) {
      let bestLen = -1;
      for (const k of topLevelKeys) {
        const v = root[k];
        if (Array.isArray(v) && v.length > bestLen) {
          bestLen = v.length;
          recordCollectionKey = k;
          records = v.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
        }
      }
    }
  }

  if (records.length === 0) {
    warnings.push('No array of selection or fixture records was detected at the top level.');
  }

  const fixtureIds = new Set<string>();
  const settledFixtureIds = new Set<string>();
  const missingSrsFixtures = new Set<string>();
  const missingSosFixtures = new Set<string>();
  let perRecordDefCount = 0;
  let hasPerRecordDefs = false;
  let receiptCount = 0;
  const detectedVars = new Set<string>();
  let earliestMs = Infinity;
  let latestMs = -Infinity;

  for (let i = 0; i < records.length; i += 1) {
    const rawRec = records[i];
    const recDefs =
      rawRec.definitions && typeof rawRec.definitions === 'object' && !Array.isArray(rawRec.definitions)
        ? (rawRec.definitions as Record<string, unknown>)
        : {};
    const recDefKeys = Object.keys(recDefs).length;
    if (recDefKeys > 0) {
      hasPerRecordDefs = true;
      perRecordDefCount += recDefKeys;
    }

    const mergedDefs = { ...rootDefs, ...recDefs };
    const rec = (
      Object.keys(mergedDefs).length > 0 ? resolveSchema3Refs(rawRec, mergedDefs) : rawRec
    ) as Record<string, unknown>;

    const fixtureKey = extractFixtureId(rec, i);
    fixtureIds.add(fixtureKey);

    const settled = hasSettledOutcome(rec);
    if (settled) {
      settledFixtureIds.add(fixtureKey);
    }
    if (
      rec.receipt ||
      rec.receiptHash ||
      rec.receiptSha256 ||
      rec.receiptValid ||
      rec.checksum ||
      rec.receiptPayload
    ) {
      receiptCount += 1;
    }

    const { homeObj, awayObj } = findTeamObjectCandidates(rec);
    if (homeObj && awayObj) {
      detectMappedTeamFields(homeObj, 'home', detectedVars);
      detectMappedTeamFields(awayObj, 'away', detectedVars);
      if (
        settled &&
        (homeObj.srs === null || homeObj.srs === undefined || awayObj.srs === null || awayObj.srs === undefined)
      ) {
        missingSrsFixtures.add(fixtureKey);
      }
      if (
        settled &&
        (homeObj.sos === null || homeObj.sos === undefined || awayObj.sos === null || awayObj.sos === undefined)
      ) {
        missingSosFixtures.add(fixtureKey);
      }
    }

    const iso = extractIsoTimestamp(rec);
    if (iso) {
      const ms = Date.parse(iso);
      if (ms < earliestMs) earliestMs = ms;
      if (ms > latestMs) latestMs = ms;
    }
  }

  if (hasPerRecordDefs) {
    if (!definitionTableKeys.includes('records[].definitions')) {
      definitionTableKeys.push('records[].definitions');
    }
    definitionCount += perRecordDefCount;
  }

  const allExpectedVars = [
    ...TEAM_STAT_FIELDS.map((f) => `home.${f}`),
    ...TEAM_STAT_FIELDS.map((f) => `away.${f}`),
  ];
  const missingCourtQuantVariables = allExpectedVars.filter((v) => !detectedVars.has(v));

  if (settledFixtureIds.size === 0 && records.length > 0) {
    warnings.push(
      'No settled final-score fields detected; inspect sampleRecordSchema paths for outcome keys.',
    );
  }

  return {
    inspectedAtIso: new Date().toISOString(),
    fileName,
    fileSizeBytes,
    topLevelKeys,
    schemaVersion,
    headerMetadata,
    definitionTableKeys,
    definitionCount,
    recordCollectionKey,
    totalRecords: records.length,
    uniqueFixtureCount: fixtureIds.size,
    settledFixtureCount: settledFixtureIds.size,
    missingSrsCount: missingSrsFixtures.size,
    missingSosCount: missingSosFixtures.size,
    receiptCount,
    detectedCourtQuantVariables: Array.from(detectedVars).sort(),
    missingCourtQuantVariables,
    sampleRecordSchema: collectSchemaFields(records),
    dateRange: {
      earliest: Number.isFinite(earliestMs) ? new Date(earliestMs).toISOString() : null,
      latest: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null,
    },
    warnings,
  };
}
