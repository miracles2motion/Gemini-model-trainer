import { inspectAuditPayload } from './auditParser.ts';
import {
  extractAuditFixtures,
  type BacktestFixture,
} from './backtestEngine.ts';
import {
  RESERVED_ABBREVIATIONS,
  validateCourtQuantPackage,
} from './courtquantEngine.ts';
import type {
  AuditInspectionSummary,
  CourtQuantModel,
  CourtQuantPackage,
} from './courtquantTypes.ts';

export interface StoredAuditDataset {
  fileName: string;
  fileSizeBytes: number;
  updatedAtIso: string;
  summary: AuditInspectionSummary;
  fixtures: BacktestFixture[];
}

export interface WorkspaceLibraryState {
  models: CourtQuantModel[];
  benchmarkAbbr: string | null;
}

export interface WorkspaceSnapshot {
  library: WorkspaceLibraryState;
  audit: StoredAuditDataset | null;
}

export interface ModelImportParseResult {
  valid: boolean;
  models: CourtQuantModel[];
  errors: string[];
}

export const DEFAULT_EMPTY_LIBRARY: WorkspaceLibraryState = {
  models: [],
  benchmarkAbbr: null,
};

function sanitizeModel(raw: CourtQuantModel): CourtQuantModel {
  return {
    fullName: String(raw.fullName ?? '').trim(),
    abbreviation: String(raw.abbreviation ?? '').trim().toUpperCase(),
    description: typeof raw.description === 'string' ? raw.description : '',
    formulas: {
      matchTotal: raw.formulas?.matchTotal ?? null,
      homeTotal: raw.formulas?.homeTotal ?? null,
      awayTotal: raw.formulas?.awayTotal ?? null,
      handicap: raw.formulas?.handicap ?? null,
      straightWin: raw.formulas?.straightWin ?? null,
      decision: raw.formulas?.decision ?? null,
      pickGate: raw.formulas?.pickGate ?? null,
    },
    ...(typeof raw.builtIn === 'boolean' ? { builtIn: raw.builtIn } : {}),
    ...(typeof raw.attribution === 'string' && raw.attribution.trim()
      ? { attribution: raw.attribution.trim() }
      : {}),
  };
}

export function parseAndValidateModelImport(rawJsonText: string): ModelImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch (err) {
    return {
      valid: false,
      models: [],
      errors: [
        err instanceof Error ? `Invalid JSON syntax: ${err.message}` : 'Invalid JSON syntax',
      ],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      models: [],
      errors: [
        'Model file must be a CourtQuant JSON object ({ schemaVersion: 1, app: "CourtQuant", models: [...] }).',
      ],
    };
  }

  const candidatePkg = parsed as CourtQuantPackage;
  const validation = validateCourtQuantPackage(candidatePkg);
  if (!validation.valid) {
    return {
      valid: false,
      models: [],
      errors: validation.errors,
    };
  }

  return {
    valid: true,
    models: candidatePkg.models.map(sanitizeModel),
    errors: [],
  };
}

export function mergeImportedModels(
  existing: CourtQuantModel[],
  incoming: CourtQuantModel[],
): {
  models: CourtQuantModel[];
  addedCount: number;
  updatedCount: number;
} {
  const next = existing.map(sanitizeModel);
  const indexByAbbr = new Map<string, number>();
  next.forEach((m, idx) => indexByAbbr.set(m.abbreviation, idx));

  let addedCount = 0;
  let updatedCount = 0;

  for (const raw of incoming) {
    const clean = sanitizeModel(raw);
    const existingIdx = indexByAbbr.get(clean.abbreviation);
    if (existingIdx !== undefined) {
      next[existingIdx] = clean;
      updatedCount += 1;
    } else {
      indexByAbbr.set(clean.abbreviation, next.length);
      next.push(clean);
      addedCount += 1;
    }
  }

  return { models: next, addedCount, updatedCount };
}

export function deleteModelByAbbr(models: CourtQuantModel[], abbr: string): CourtQuantModel[] {
  const target = abbr.trim().toUpperCase();
  return models.filter((m) => m.abbreviation.toUpperCase() !== target);
}

export function resolveBenchmarkAbbr(
  models: CourtQuantModel[],
  currentBenchmark: string | null,
): string | null {
  if (!currentBenchmark) return null;
  const match = models.find((m) => m.abbreviation === currentBenchmark);
  return match ? match.abbreviation : null;
}

export function buildCourtQuantExportPackage(models: CourtQuantModel[]): CourtQuantPackage {
  return {
    schemaVersion: 1,
    app: 'CourtQuant',
    exportedAtEpochMs: Date.now(),
    models: models.map((m) => ({
      fullName: m.fullName.trim(),
      abbreviation: m.abbreviation.trim().toUpperCase(),
      description: m.description,
      formulas: {
        matchTotal: m.formulas.matchTotal ?? null,
        homeTotal: m.formulas.homeTotal ?? null,
        awayTotal: m.formulas.awayTotal ?? null,
        handicap: m.formulas.handicap ?? null,
        straightWin: m.formulas.straightWin ?? null,
        decision: m.formulas.decision ?? null,
        pickGate: m.formulas.pickGate ?? null,
      },
    })),
  };
}

export function createBlankDraftModel(existingModels: CourtQuantModel[] = []): CourtQuantModel {
  const taken = new Set(existingModels.map((m) => m.abbreviation.toUpperCase()));
  let idx = 1;
  let candidate = `MOD${idx}`;
  while (taken.has(candidate) || RESERVED_ABBREVIATIONS.has(candidate)) {
    idx += 1;
    candidate = `MOD${idx}`;
  }

  return {
    fullName: `Custom Research Model ${idx}`,
    abbreviation: candidate,
    description: '',
    formulas: {
      matchTotal: '(home.pts_g + away.opp_g + away.pts_g + home.opp_g) * 0.5',
      homeTotal: '(home.pts_g + away.opp_g) * 0.5',
      awayTotal: '(away.pts_g + home.opp_g) * 0.5',
      handicap: '(proj.home - proj.away)',
      straightWin: '1 / (1 + pow(2.71828, -(proj.margin * 0.145)))',
      decision: 'opt.ev * 100 + opt.prob * 10',
      pickGate: 'opt.ev',
    },
    builtIn: false,
  };
}

export function createStoredAuditDataset(
  rawData: unknown,
  fileName: string,
  fileSizeBytes: number,
): StoredAuditDataset {
  const summary = inspectAuditPayload(rawData, fileName, fileSizeBytes);
  const fixtures = extractAuditFixtures(rawData);
  return {
    fileName,
    fileSizeBytes,
    updatedAtIso: new Date().toISOString(),
    summary,
    fixtures,
  };
}

// Browser IndexedDB Driver (with graceful in-memory fallback when indexedDB is unavailable)
const DB_NAME = 'courtquant-model-lab';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const KEY_LIBRARY = 'library';
const KEY_AUDIT = 'audit';

const memoryFallbackStore = new Map<string, unknown>();

function hasIndexedDb(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined';
}

function openLabDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open browser IndexedDB'));
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  if (!hasIndexedDb()) {
    return (memoryFallbackStore.get(key) as T | undefined) ?? null;
  }
  const db = await openLabDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error(`IndexedDB read failed for ${key}`));
    tx.oncomplete = () => db.close();
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  if (!hasIndexedDb()) {
    memoryFallbackStore.set(key, value);
    return;
  }
  const db = await openLabDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(`IndexedDB write failed for ${key}`));
    };
  });
}

async function idbDelete(key: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryFallbackStore.delete(key);
    return;
  }
  const db = await openLabDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(`IndexedDB delete failed for ${key}`));
    };
  });
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [lib, audit] = await Promise.all([
    idbGet<WorkspaceLibraryState>(KEY_LIBRARY),
    idbGet<StoredAuditDataset>(KEY_AUDIT),
  ]);
  const models = Array.isArray(lib?.models) ? lib.models.map(sanitizeModel) : [];
  const benchmarkAbbr = resolveBenchmarkAbbr(models, lib?.benchmarkAbbr ?? null);
  return {
    library: { models, benchmarkAbbr },
    audit: audit ?? null,
  };
}

export async function saveLibraryState(state: WorkspaceLibraryState): Promise<void> {
  await idbSet<WorkspaceLibraryState>(KEY_LIBRARY, {
    models: state.models.map(sanitizeModel),
    benchmarkAbbr: resolveBenchmarkAbbr(state.models, state.benchmarkAbbr),
  });
}

export async function clearSavedModelsState(): Promise<void> {
  await idbSet<WorkspaceLibraryState>(KEY_LIBRARY, DEFAULT_EMPTY_LIBRARY);
}

export async function saveAuditDataset(dataset: StoredAuditDataset): Promise<void> {
  await idbSet<StoredAuditDataset>(KEY_AUDIT, dataset);
}

export async function clearAuditDataset(): Promise<void> {
  await idbDelete(KEY_AUDIT);
}
