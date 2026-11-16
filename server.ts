import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { inspectAuditPayload } from './src/lib/auditParser.ts';
import {
  backtestModel,
  extractAuditFixtures,
  summarizeBacktestDataset,
  type BacktestDatasetSummary,
  type BacktestFixture,
  type ModelBacktestReport,
} from './src/lib/backtestEngine.ts';
import {
  CHAMPION_MODEL_QVCE,
  CHAMPION_MODEL_QWIN,
  CHAMPION_PACKAGE_QVCE,
  CHAMPION_PACKAGE_QWIN,
} from './src/lib/championModel.ts';
import { validateCourtQuantModel, validateCourtQuantPackage } from './src/lib/courtquantEngine.ts';
import type {
  AuditInspectionSummary,
  CourtQuantModel,
  CourtQuantPackage,
  UploadStatusResponse,
} from './src/lib/courtquantTypes.ts';

const PORT = 3000;
const ROOT_DIR = process.cwd();
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');
const AUDIT_FILE_PATH = path.resolve(DATA_DIR, 'capture-audit.json');
const AUDIT_SUMMARY_PATH = path.resolve(DATA_DIR, 'audit-summary.json');
const CUSTOM_MODELS_PATH = path.resolve(DATA_DIR, 'custom-models.json');
const CHAMPION_DATA_PATH = path.resolve(DATA_DIR, 'qvce-champion-model.json');
const CHAMPION_PUBLIC_PATH = path.resolve(PUBLIC_DIR, 'qvce-champion-model.json');
const QWIN_DATA_PATH = path.resolve(DATA_DIR, 'qwin-champion-model.json');
const QWIN_PUBLIC_PATH = path.resolve(PUBLIC_DIR, 'qwin-champion-model.json');
const BUILTIN_MODELS_PATH = path.resolve(
  ROOT_DIR,
  'public/assets/aistudio/courtquant-models__1__e8e6e8ec.json',
);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Persist verified RFC-8259 champion packages to disk so the user can import/download directly
const championJson = JSON.stringify(CHAMPION_PACKAGE_QVCE, null, 2);
fs.writeFileSync(CHAMPION_DATA_PATH, championJson);
fs.writeFileSync(CHAMPION_PUBLIC_PATH, championJson);
const qwinJson = JSON.stringify(CHAMPION_PACKAGE_QWIN, null, 2);
fs.writeFileSync(QWIN_DATA_PATH, qwinJson);
fs.writeFileSync(QWIN_PUBLIC_PATH, qwinJson);

let cachedAuditMtimeMs = -1;
let cachedFixtures: BacktestFixture[] | null = null;
let cachedDatasetSummary: BacktestDatasetSummary | null = null;
let cachedBaselineReports: ModelBacktestReport[] | null = null;

function invalidateBacktestCache() {
  cachedAuditMtimeMs = -1;
  cachedFixtures = null;
  cachedDatasetSummary = null;
  cachedBaselineReports = null;
}

function getAuditFixturesCached(): {
  fixtures: BacktestFixture[];
  datasetSummary: BacktestDatasetSummary;
} {
  const stat = fs.statSync(AUDIT_FILE_PATH);
  if (cachedFixtures && cachedDatasetSummary && cachedAuditMtimeMs === stat.mtimeMs) {
    return { fixtures: cachedFixtures, datasetSummary: cachedDatasetSummary };
  }
  const raw = JSON.parse(fs.readFileSync(AUDIT_FILE_PATH, 'utf8'));
  const fixtures = extractAuditFixtures(raw);
  const datasetSummary = summarizeBacktestDataset(fixtures);
  cachedAuditMtimeMs = stat.mtimeMs;
  cachedFixtures = fixtures;
  cachedDatasetSummary = datasetSummary;
  cachedBaselineReports = null;
  return { fixtures, datasetSummary };
}

function readAuditSummary(): AuditInspectionSummary | null {
  if (!fs.existsSync(AUDIT_SUMMARY_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(AUDIT_SUMMARY_PATH, 'utf8')) as AuditInspectionSummary;
  } catch {
    return null;
  }
}

function runAndPersistInspection(fileName = 'capture-audit.json'): AuditInspectionSummary {
  const stat = fs.statSync(AUDIT_FILE_PATH);
  const raw = JSON.parse(fs.readFileSync(AUDIT_FILE_PATH, 'utf8'));
  const summary = inspectAuditPayload(raw, fileName, stat.size);
  fs.writeFileSync(AUDIT_SUMMARY_PATH, JSON.stringify(summary, null, 2));
  return summary;
}

function loadAllModels(): {
  basePkg: CourtQuantPackage;
  customPkg: CourtQuantPackage | null;
  allModels: CourtQuantModel[];
} {
  const basePkg = JSON.parse(fs.readFileSync(BUILTIN_MODELS_PATH, 'utf8')) as CourtQuantPackage;
  let customPkg: CourtQuantPackage | null = null;
  if (fs.existsSync(CUSTOM_MODELS_PATH)) {
    try {
      customPkg = JSON.parse(fs.readFileSync(CUSTOM_MODELS_PATH, 'utf8')) as CourtQuantPackage;
    } catch {
      customPkg = null;
    }
  }
  const seen = new Set<string>();
  const allModels: CourtQuantModel[] = [];
  for (const m of [
    CHAMPION_MODEL_QWIN,
    CHAMPION_MODEL_QVCE,
    ...(basePkg.models ?? []),
    ...(customPkg?.models ?? []),
  ]) {
    if (!seen.has(m.abbreviation)) {
      seen.add(m.abbreviation);
      allModels.push(m);
    }
  }
  return { basePkg, customPkg, allModels };
}

async function startServer() {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/models', (_req, res) => {
    try {
      const { basePkg, customPkg, allModels } = loadAllModels();
      const validation = validateCourtQuantPackage({
        schemaVersion: 1,
        app: 'CourtQuant',
        models: allModels,
      });
      res.json({
        basePackage: basePkg,
        championModel: CHAMPION_MODEL_QVCE,
        championPackage: CHAMPION_PACKAGE_QVCE,
        customPackage: customPkg,
        allModels,
        validation,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load CourtQuant models',
      });
    }
  });

  app.post('/api/models/save', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const pkg = req.body as CourtQuantPackage;
      const validation = validateCourtQuantPackage(pkg);
      if (!validation.valid) {
        res.status(400).json({ valid: false, errors: validation.errors });
        return;
      }
      fs.writeFileSync(CUSTOM_MODELS_PATH, JSON.stringify(pkg, null, 2));
      cachedBaselineReports = null;
      res.json({ valid: true, savedCount: pkg.models.length });
    } catch (err) {
      res.status(400).json({
        valid: false,
        errors: [err instanceof Error ? err.message : 'Invalid JSON payload'],
      });
    }
  });

  app.get('/api/backtest', (_req, res) => {
    if (!fs.existsSync(AUDIT_FILE_PATH)) {
      res.json({ hasAuditFile: false, datasetSummary: null, reports: [] });
      return;
    }
    try {
      const { fixtures, datasetSummary } = getAuditFixturesCached();
      const { allModels } = loadAllModels();
      if (!cachedBaselineReports) {
        cachedBaselineReports = allModels.map((m) => backtestModel(m, fixtures, 1.0));
      }
      res.json({
        hasAuditFile: true,
        datasetSummary,
        benchmarkAbbr: 'CCVS',
        championAbbr: CHAMPION_MODEL_QVCE.abbreviation,
        reports: cachedBaselineReports,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to execute backtest',
      });
    }
  });

  app.post('/api/backtest/evaluate', express.json({ limit: '1mb' }), (req, res) => {
    if (!fs.existsSync(AUDIT_FILE_PATH)) {
      res.status(404).json({ error: 'No capture-audit.json dataset loaded on disk' });
      return;
    }
    try {
      const model = req.body as CourtQuantModel;
      const val = validateCourtQuantModel(model);
      if (!val.valid) {
        res.status(400).json({ valid: false, issues: val.issues });
        return;
      }
      const { fixtures, datasetSummary } = getAuditFixturesCached();
      const draftReport = backtestModel(model, fixtures, 1.0);
      const { basePkg } = loadAllModels();
      const ccvs = basePkg.models.find((m) => m.abbreviation === 'CCVS');
      const benchmarkReport = ccvs ? backtestModel(ccvs, fixtures, 1.0) : null;
      res.json({
        valid: true,
        datasetSummary,
        report: draftReport,
        benchmarkReport,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to backtest model',
      });
    }
  });

  app.get('/api/audit/status', (_req, res) => {
    const exists = fs.existsSync(AUDIT_FILE_PATH);
    if (!exists) {
      const payload: UploadStatusResponse = {
        hasAuditFile: false,
        fileSizeBytes: 0,
        updatedAtIso: null,
        summary: null,
      };
      res.json(payload);
      return;
    }
    const stat = fs.statSync(AUDIT_FILE_PATH);
    let summary = readAuditSummary();
    if (
      !summary ||
      (summary.totalRecords > 0 &&
        summary.settledFixtureCount === 0 &&
        summary.detectedCourtQuantVariables.length === 0)
    ) {
      try {
        summary = runAndPersistInspection('capture-audit.json');
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to parse uploaded capture-audit.json',
        });
        return;
      }
    }
    const payload: UploadStatusResponse = {
      hasAuditFile: true,
      fileSizeBytes: stat.size,
      updatedAtIso: stat.mtime.toISOString(),
      summary,
    };
    res.json(payload);
  });

  app.post('/api/upload/init', express.json(), (req, res) => {
    const rawId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : '';
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId) {
      res.status(400).json({ error: 'Invalid uploadId' });
      return;
    }
    const partPath = path.resolve(DATA_DIR, `.upload_${safeId}.part`);
    fs.writeFileSync(partPath, Buffer.alloc(0));
    res.json({ ok: true, uploadId: safeId });
  });

  app.post(
    '/api/upload/chunk',
    express.raw({ type: 'application/octet-stream', limit: '2mb' }),
    (req, res) => {
      const rawId = typeof req.query.uploadId === 'string' ? req.query.uploadId : '';
      const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeId) {
        res.status(400).json({ error: 'Invalid uploadId' });
        return;
      }
      const partPath = path.resolve(DATA_DIR, `.upload_${safeId}.part`);
      if (!fs.existsSync(partPath)) {
        res.status(404).json({ error: 'Upload session not initialized' });
        return;
      }
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      fs.appendFileSync(partPath, buf);
      res.json({ ok: true, receivedBytes: buf.length });
    },
  );

  app.post('/api/upload/complete', express.json(), (req, res) => {
    const rawId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : '';
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName =
      typeof req.body?.fileName === 'string' && req.body.fileName.trim()
        ? req.body.fileName.trim()
        : 'capture-audit.json';
    if (!safeId) {
      res.status(400).json({ error: 'Invalid uploadId' });
      return;
    }
    const partPath = path.resolve(DATA_DIR, `.upload_${safeId}.part`);
    if (!fs.existsSync(partPath)) {
      res.status(404).json({ error: 'Upload temp file missing' });
      return;
    }

    try {
      const stat = fs.statSync(partPath);
      const text = fs.readFileSync(partPath, 'utf8');
      const parsed = JSON.parse(text);
      const summary = inspectAuditPayload(parsed, fileName, stat.size);

      fs.renameSync(partPath, AUDIT_FILE_PATH);
      fs.writeFileSync(AUDIT_SUMMARY_PATH, JSON.stringify(summary, null, 2));
      invalidateBacktestCache();

      res.json({
        ok: true,
        fileSizeBytes: stat.size,
        summary,
      });
    } catch (err) {
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
      }
      res.status(400).json({
        error:
          err instanceof Error
            ? `Failed to parse uploaded JSON: ${err.message}`
            : 'Invalid JSON file',
      });
    }
  });

  app.delete('/api/audit', (_req, res) => {
    if (fs.existsSync(AUDIT_FILE_PATH)) {
      fs.unlinkSync(AUDIT_FILE_PATH);
    }
    if (fs.existsSync(AUDIT_SUMMARY_PATH)) {
      fs.unlinkSync(AUDIT_SUMMARY_PATH);
    }
    invalidateBacktestCache();
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CourtQuant Model Lab listening on http://0.0.0.0:${PORT}`);
    setTimeout(() => {
      if (fs.existsSync(AUDIT_FILE_PATH) && !cachedBaselineReports) {
        try {
          const { fixtures } = getAuditFixturesCached();
          const { allModels } = loadAllModels();
          cachedBaselineReports = allModels.map((m) => backtestModel(m, fixtures, 1.0));
        } catch {
          // ignore warmup error
        }
      }
    }, 50);
  });
}

startServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
