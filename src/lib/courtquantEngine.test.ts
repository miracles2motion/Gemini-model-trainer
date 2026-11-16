import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateDecisionOrGate,
  evaluateModelProjections,
  validateCourtQuantModel,
  validateCourtQuantPackage,
} from './courtquantEngine';
import type { CourtQuantPackage, TeamStats } from './courtquantTypes';

const SAMPLE_HOME: TeamStats = {
  g: 5,
  srs: 12.4,
  sos: 3.1,
  pts: 410,
  opp_pts: 345,
  pts_g: 82.0,
  opp_g: 69.0,
  total_g: 151.0,
  pace: 71.2,
  fga: 310,
  fta: 105,
  orb: 54,
  tov: 58,
  mp: 200,
  fg: 145,
  fg3: 44,
  fg3a: 118,
  ft: 76,
  opp_fg: 122,
  opp_fga: 295,
  opp_fg3: 32,
  opp_fg3a: 102,
  opp_ft: 69,
  opp_fta: 98,
  opp_orb: 42,
  opp_tov: 68,
};

const SAMPLE_AWAY: TeamStats = {
  g: 5,
  srs: 4.2,
  sos: 1.5,
  pts: 365,
  opp_pts: 355,
  pts_g: 73.0,
  opp_g: 71.0,
  total_g: 144.0,
  pace: 68.4,
  fga: 292,
  fta: 88,
  orb: 45,
  tov: 64,
  mp: 200,
  fg: 129,
  fg3: 36,
  fg3a: 109,
  ft: 71,
  opp_fg: 126,
  opp_fga: 288,
  opp_fg3: 37,
  opp_fg3a: 105,
  opp_ft: 66,
  opp_fta: 92,
  opp_orb: 49,
  opp_tov: 60,
};

test('all 17 models in uploaded courtquant-models JSON validate and evaluate cleanly', () => {
  const jsonPath = path.resolve(
    process.cwd(),
    'public/assets/aistudio/courtquant-models__1__e8e6e8ec.json',
  );
  const pkg = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as CourtQuantPackage;
  assert.equal(pkg.models.length, 17);

  const pkgValidation = validateCourtQuantPackage(pkg);
  assert.equal(pkgValidation.valid, true, pkgValidation.errors.join('\n'));

  for (const model of pkg.models) {
    const proj = evaluateModelProjections(model.formulas, SAMPLE_HOME, SAMPLE_AWAY);
    assert.deepEqual(
      proj.errors,
      {},
      `Model ${model.abbreviation} had evaluation errors: ${JSON.stringify(proj.errors)}`,
    );
    assert.equal(typeof proj.matchTotal, 'number');
    assert.ok(proj.matchTotal! >= 20 && proj.matchTotal! <= 400);

    if (model.formulas.decision) {
      const dec = evaluateDecisionOrGate(
        model.formulas.decision,
        SAMPLE_HOME,
        SAMPLE_AWAY,
        {
          home: proj.homeTotal,
          away: proj.awayTotal,
          total: proj.matchTotal,
          margin: proj.handicap,
        },
        {
          edge: 4.5,
          z: 0.42,
          prob: 0.61,
          odds: 1.9,
          implied_prob: 1 / 1.9,
          ev: 0.61 * 1.9 - 1,
          line: 146.5,
          is_total: 1,
          is_home_total: 0,
          is_away_total: 0,
          is_handicap: 0,
          is_win: 0,
        },
        1.05,
      );
      assert.equal(dec.error, undefined);
      assert.equal(typeof dec.value, 'number');
    }
  }
});

test('CCVS maintains scoreboard coherence and handles missing SRS cleanly', () => {
  const jsonPath = path.resolve(
    process.cwd(),
    'public/assets/aistudio/courtquant-models__1__e8e6e8ec.json',
  );
  const pkg = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as CourtQuantPackage;
  const ccvs = pkg.models.find((m) => m.abbreviation === 'CCVS');
  assert.ok(ccvs);

  const proj = evaluateModelProjections(ccvs.formulas, SAMPLE_HOME, SAMPLE_AWAY);
  assert.ok(proj.matchTotal !== null && proj.homeTotal !== null && proj.awayTotal !== null && proj.handicap !== null);
  assert.ok(Math.abs(proj.homeTotal! + proj.awayTotal! - proj.matchTotal!) < 1e-9);
  assert.ok(Math.abs(proj.homeTotal! - proj.awayTotal! - proj.handicap!) < 1e-9);

  const missingSrsHome: TeamStats = { ...SAMPLE_HOME, srs: null };
  const noDataProj = evaluateModelProjections(ccvs.formulas, missingSrsHome, SAMPLE_AWAY);
  assert.ok(noDataProj.matchTotal !== null);
  assert.equal(noDataProj.handicap, null);
  assert.ok(noDataProj.noDataSlots.includes('handicap'));
});

import { backtestModel, extractAuditFixtures } from './backtestEngine';
import {
  CHAMPION_MODEL_QVCE,
  CHAMPION_MODEL_QWIN,
  CHAMPION_PACKAGE_QVCE,
  CHAMPION_PACKAGE_QWIN,
} from './championModel';

test('validator rejects forbidden syntax, reserved IDs, and opt.* inside market slots', () => {
  const bad = validateCourtQuantModel({
    fullName: 'Bad Model',
    abbreviation: 'M3',
    description: 'Invalid test model',
    formulas: {
      matchTotal: 'pow(home.pts_g, 2) + opt.edge + home.pace^2',
    },
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.issues.some((i) => i.message.includes('reserved')));
  assert.ok(bad.issues.some((i) => i.message.includes('Forbidden syntax "^"')));
});

test('QVCE champion package passes RFC-8259 & CourtQuant strict validation and scoreboard coherence', () => {
  const pkgValidation = validateCourtQuantPackage(CHAMPION_PACKAGE_QVCE);
  assert.equal(pkgValidation.valid, true, pkgValidation.errors.join('\n'));
  assert.equal(CHAMPION_MODEL_QVCE.abbreviation, 'QVCE');

  const modelCheck = validateCourtQuantModel(CHAMPION_MODEL_QVCE);
  assert.equal(modelCheck.valid, true);

  for (const val of Object.values(CHAMPION_MODEL_QVCE.formulas)) {
    if (typeof val === 'string') {
      assert.ok(val.length <= 2000);
      assert.equal(val.includes('\n'), false);
    }
  }

  const proj = evaluateModelProjections(CHAMPION_MODEL_QVCE.formulas, SAMPLE_HOME, SAMPLE_AWAY);
  assert.deepEqual(proj.errors, {});
  assert.ok(proj.matchTotal !== null && proj.homeTotal !== null && proj.awayTotal !== null && proj.handicap !== null);
  assert.ok(Math.abs(proj.homeTotal! + proj.awayTotal! - proj.matchTotal!) < 1e-9);
  assert.ok(Math.abs(proj.homeTotal! - proj.awayTotal! - proj.handicap!) < 1e-9);

  // Backtest engine evaluates extracted Schema-3 fixture & SportyBet markets cleanly
  const mockAudit = {
    schemaVersion: 3,
    records: [
      {
        fixtureKey: 'm1',
        definitions: {
          h: { games: 4, srs: 12, sos: 2, totalPoints: 320, opponentPoints: 270, fieldGoalAttempts: 240, freeThrowAttempts: 80, offensiveRebounds: 38, turnovers: 44, mp: 160, fg: 112, fg3: 32, fg3a: 90, ft: 64, oppFg: 96, oppFga: 240, oppFg3: 24, oppFg3a: 80, oppFt: 54, oppFta: 72, oppOrb: 34, oppTov: 50 },
          a: { games: 4, srs: 4, sos: 1, totalPoints: 280, opponentPoints: 290, fieldGoalAttempts: 232, freeThrowAttempts: 72, offensiveRebounds: 34, turnovers: 52, mp: 160, fg: 100, fg3: 26, fg3a: 84, ft: 54, oppFg: 104, oppFga: 240, oppFg3: 30, oppFg3a: 86, oppFt: 52, oppFta: 70, oppOrb: 36, oppTov: 44 },
        },
        analysis: {
          status: 'Ended',
          homeScore: 76,
          awayScore: 67,
          kickoffIso: '2026-11-15T19:00:00Z',
          capturedPreTipoff: true,
          homeStats: { $ref: 'h' },
          awayStats: { $ref: 'a' },
          frozenOffer: {
            markets: [
              { id: '225', specifier: 'total=150.5', outcomes: [{ desc: 'Over 150.5', odds: 1.9 }, { desc: 'Under 150.5', odds: 1.88 }] },
            ],
          },
        },
      },
    ],
  };

  const fixtures = extractAuditFixtures(mockAudit);
  assert.equal(fixtures.length, 1);
  const report = backtestModel(CHAMPION_MODEL_QVCE, fixtures, 1.0);
  assert.equal(report.all.totCount, 1);
  assert.equal(report.test.p1GateCount, 1);
  assert.equal(report.test.p1GatePnlUnits, 0.88);
});

test('QWIN win-rate champion passes RFC-8259 & CourtQuant strict validation and scores missing-SRS games cleanly', () => {
  const pkgValidation = validateCourtQuantPackage(CHAMPION_PACKAGE_QWIN);
  assert.equal(pkgValidation.valid, true, pkgValidation.errors.join('\n'));
  assert.equal(CHAMPION_MODEL_QWIN.abbreviation, 'QWIN');
  assert.equal(CHAMPION_MODEL_QWIN.description.split(/\n\n/).length, 4);

  const modelCheck = validateCourtQuantModel(CHAMPION_MODEL_QWIN);
  assert.equal(modelCheck.valid, true);

  for (const val of Object.values(CHAMPION_MODEL_QWIN.formulas)) {
    if (typeof val === 'string') {
      assert.ok(val.length <= 2000);
      assert.equal(val.includes('\n'), false);
    }
  }

  // QWIN decision relies only on proj.total (never proj.margin), so missing-SRS fixtures still score Match O/U!
  const missingSrsHome: TeamStats = { ...SAMPLE_HOME, srs: null };
  const noSrsProj = evaluateModelProjections(CHAMPION_MODEL_QWIN.formulas, missingSrsHome, SAMPLE_AWAY);
  assert.ok(noSrsProj.matchTotal !== null);
  assert.equal(noSrsProj.handicap, null);

  const dec = evaluateDecisionOrGate(
    CHAMPION_MODEL_QWIN.formulas.decision,
    missingSrsHome,
    SAMPLE_AWAY,
    {
      home: noSrsProj.homeTotal,
      away: noSrsProj.awayTotal,
      total: noSrsProj.matchTotal,
      margin: noSrsProj.handicap,
    },
    {
      edge: 12.0,
      z: 0.8,
      prob: 0.788,
      odds: 1.35,
      implied_prob: 1 / 1.35,
      ev: 0.788 * 1.35 - 1,
      line: 155.5,
      is_total: 1,
      is_home_total: 0,
      is_away_total: 0,
      is_handicap: 0,
      is_win: 0,
    },
    1.0,
  );
  assert.equal(dec.error, undefined);
  assert.equal(typeof dec.value, 'number');
});


