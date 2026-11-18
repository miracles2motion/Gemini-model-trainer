import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestModel, extractAuditFixtures } from './backtestEngine.ts';
import {
  evaluateDecisionOrGate,
  evaluateModelProjections,
  validateCourtQuantModel,
  validateCourtQuantPackage,
} from './courtquantEngine.ts';
import type { CourtQuantModel, CourtQuantPackage, TeamStats } from './courtquantTypes.ts';

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

const VALID_SAMPLE_MODEL: CourtQuantModel = {
  fullName: 'Balanced Tempo Baseline',
  abbreviation: 'BTB',
  description: 'Self-contained coherent test model for CourtQuant AST evaluation.',
  formulas: {
    matchTotal: '(home.pts_g + away.opp_g + away.pts_g + home.opp_g) * 0.5',
    homeTotal: '0.5 * (proj.total + proj.margin)',
    awayTotal: '0.5 * (proj.total - proj.margin)',
    handicap: '((home.srs - away.srs) + 3.2)',
    straightWin: '1 / (1 + pow(2.71828, -(proj.margin * 0.145)))',
    decision: 'opt.ev * 100 + opt.prob * 5',
    pickGate: 'opt.ev',
  },
};

test('validates CourtQuant package, maintains scoreboard coherence, and detects missing SRS gracefully', () => {
  const pkg: CourtQuantPackage = {
    schemaVersion: 1,
    app: 'CourtQuant',
    models: [VALID_SAMPLE_MODEL],
  };

  const pkgValidation = validateCourtQuantPackage(pkg);
  assert.equal(pkgValidation.valid, true, pkgValidation.errors.join('\n'));

  const proj = evaluateModelProjections(VALID_SAMPLE_MODEL.formulas, SAMPLE_HOME, SAMPLE_AWAY);
  assert.deepEqual(proj.errors, {});
  assert.ok(proj.matchTotal !== null && proj.homeTotal !== null && proj.awayTotal !== null && proj.handicap !== null);
  assert.ok(Math.abs(proj.homeTotal! + proj.awayTotal! - proj.matchTotal!) < 1e-9);
  assert.ok(Math.abs(proj.homeTotal! - proj.awayTotal! - proj.handicap!) < 1e-9);

  const missingSrsHome: TeamStats = { ...SAMPLE_HOME, srs: null };
  const noSrsProj = evaluateModelProjections(VALID_SAMPLE_MODEL.formulas, missingSrsHome, SAMPLE_AWAY);
  assert.ok(noSrsProj.matchTotal !== null);
  assert.equal(noSrsProj.handicap, null);
  assert.ok(noSrsProj.noDataSlots.includes('handicap'));
});

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

test('evaluates decision & pickGate and scores extracted Schema-3 SportyBet markets cleanly', () => {
  const proj = evaluateModelProjections(VALID_SAMPLE_MODEL.formulas, SAMPLE_HOME, SAMPLE_AWAY);
  const dec = evaluateDecisionOrGate(
    VALID_SAMPLE_MODEL.formulas.decision,
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
  const report = backtestModel(VALID_SAMPLE_MODEL, fixtures, 1.0);
  assert.equal(report.all.totCount, 1);
  assert.equal(report.all.p1AllCount, 1);
});
