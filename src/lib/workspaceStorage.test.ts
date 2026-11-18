import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBacktestDataset } from './backtestEngine.ts';
import type { CourtQuantModel } from './courtquantTypes.ts';
import {
  buildCourtQuantExportPackage,
  clearAuditDataset,
  clearSavedModelsState,
  createBlankDraftModel,
  createStoredAuditDataset,
  deleteModelByAbbr,
  loadWorkspaceSnapshot,
  mergeImportedModels,
  parseAndValidateModelImport,
  resolveBenchmarkAbbr,
  saveAuditDataset,
  saveLibraryState,
} from './workspaceStorage.ts';

const MODEL_A: CourtQuantModel = {
  fullName: 'Alpha Tempo Model',
  abbreviation: 'ALPH',
  description: 'Simple tempo baseline.',
  formulas: {
    matchTotal: '(home.pts_g + away.pts_g)',
    homeTotal: 'home.pts_g',
    awayTotal: 'away.pts_g',
    handicap: '(proj.home - proj.away)',
    straightWin: '1 / (1 + pow(2.71828, -(proj.margin * 0.14)))',
    decision: 'opt.ev * 100',
    pickGate: 'opt.ev',
  },
};

const MODEL_B: CourtQuantModel = {
  fullName: 'Beta Efficiency Model',
  abbreviation: 'BETA',
  description: 'SRS adjusted pace baseline.',
  formulas: {
    matchTotal: '(home.pts_g + away.opp_g + away.pts_g + home.opp_g) * 0.5',
    homeTotal: null,
    awayTotal: null,
    handicap: 'home.srs - away.srs + 3.0',
    straightWin: '1 / (1 + pow(2.71828, -(proj.margin * 0.14)))',
    decision: 'opt.prob',
    pickGate: null,
  },
};

test('workspace starts completely empty with zero hardcoded models or audit data', async () => {
  await Promise.all([clearSavedModelsState(), clearAuditDataset()]);
  const snapshot = await loadWorkspaceSnapshot();
  assert.equal(snapshot.library.models.length, 0);
  assert.equal(snapshot.library.benchmarkAbbr, null);
  assert.equal(snapshot.audit, null);
});

test('parseAndValidateModelImport accepts valid single & multi-model CourtQuant JSON and rejects invalid JSON', () => {
  const pkgJson = JSON.stringify({
    schemaVersion: 1,
    app: 'CourtQuant',
    models: [MODEL_A, MODEL_B],
  });
  const ok = parseAndValidateModelImport(pkgJson);
  assert.equal(ok.valid, true);
  assert.equal(ok.models.length, 2);

  const badJson = parseAndValidateModelImport('{ not json');
  assert.equal(badJson.valid, false);
  assert.ok(badJson.errors[0].includes('Invalid JSON'));

  const wrongApp = parseAndValidateModelImport(
    JSON.stringify({ schemaVersion: 1, app: 'OtherApp', models: [MODEL_A] }),
  );
  assert.equal(wrongApp.valid, false);
  assert.ok(wrongApp.errors.some((e) => e.includes('CourtQuant')));
});

test('mergeImportedModels, deleteModelByAbbr, and resolveBenchmarkAbbr handle persistence transitions cleanly', async () => {
  const first = mergeImportedModels([], [MODEL_A]);
  assert.equal(first.addedCount, 1);
  assert.equal(first.updatedCount, 0);

  const updatedModelA: CourtQuantModel = { ...MODEL_A, fullName: 'Alpha Tempo Model v2' };
  const second = mergeImportedModels(first.models, [updatedModelA, MODEL_B]);
  assert.equal(second.addedCount, 1);
  assert.equal(second.updatedCount, 1);
  assert.equal(second.models.length, 2);
  assert.equal(second.models[0].fullName, 'Alpha Tempo Model v2');

  await saveLibraryState({ models: second.models, benchmarkAbbr: 'ALPH' });
  let snap = await loadWorkspaceSnapshot();
  assert.equal(snap.library.models.length, 2);
  assert.equal(snap.library.benchmarkAbbr, 'ALPH');

  const remaining = deleteModelByAbbr(snap.library.models, 'ALPH');
  const nextBench = resolveBenchmarkAbbr(remaining, snap.library.benchmarkAbbr);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].abbreviation, 'BETA');
  assert.equal(nextBench, null);

  await saveLibraryState({ models: remaining, benchmarkAbbr: nextBench });
  snap = await loadWorkspaceSnapshot();
  assert.equal(snap.library.models.length, 1);
  assert.equal(snap.library.benchmarkAbbr, null);

  await clearSavedModelsState();
  snap = await loadWorkspaceSnapshot();
  assert.equal(snap.library.models.length, 0);
});

test('createBlankDraftModel avoids M1-M8 and existing model abbreviations', () => {
  const draft = createBlankDraftModel([
    MODEL_A,
    { ...MODEL_B, abbreviation: 'MOD1' },
    { ...MODEL_B, abbreviation: 'MOD2' },
  ]);
  assert.equal(draft.abbreviation, 'MOD3');
  const pkg = buildCourtQuantExportPackage([MODEL_A, MODEL_B]);
  assert.equal(pkg.schemaVersion, 1);
  assert.equal(pkg.app, 'CourtQuant');
  assert.equal(pkg.models.length, 2);
});

test('createStoredAuditDataset & dynamic split cutoff work cleanly across arbitrary capture dates', async () => {
  const sampleAudit = {
    schemaVersion: 3,
    records: [1, 2, 3, 4].map((day) => ({
      fixtureKey: `fx-${day}`,
      definitions: {
        h: { games: 5, srs: 8, sos: 1, totalPoints: 390, opponentPoints: 340, fieldGoalAttempts: 300, freeThrowAttempts: 90, offensiveRebounds: 40, turnovers: 55, mp: 200 },
        a: { games: 5, srs: 2, sos: 0, totalPoints: 350, opponentPoints: 360, fieldGoalAttempts: 290, freeThrowAttempts: 85, offensiveRebounds: 35, turnovers: 60, mp: 200 },
      },
      analysis: {
        status: 'Ended',
        homeScore: 78,
        awayScore: 70,
        kickoffIso: `2027-01-0${day}T19:00:00Z`,
        homeStats: { $ref: 'h' },
        awayStats: { $ref: 'a' },
      },
    })),
  };

  const dataset = createStoredAuditDataset(sampleAudit, 'custom-audit.json', 2048);
  await saveAuditDataset(dataset);
  const snap = await loadWorkspaceSnapshot();
  assert.equal(snap.audit?.fileName, 'custom-audit.json');
  assert.equal(snap.audit?.fixtures.length, 4);

  const summary = summarizeBacktestDataset(snap.audit!.fixtures);
  assert.equal(summary.totalSettledFixtures, 4);
  assert.ok(summary.trainCount > 0 && summary.testCount > 0);
  await clearAuditDataset();
});
