import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAuditPayload } from './auditParser';

test('inspectAuditPayload extracts Schema-3 headers, definitions, and variable coverage', () => {
  const mockSchema3 = {
    schemaVersion: 3,
    exportedAt: '2026-11-16T00:00:00Z',
    definitions: {
      sha256_abc: { model: 'CCVS' },
      sha256_def: { model: 'BPE' },
    },
    records: [
      {
        fixtureId: 'fx-101',
        startTime: '2026-11-12T19:00:00Z',
        receipt: { checksum: 'ok' },
        home: {
          g: 3,
          srs: 8.1,
          sos: 1.2,
          pts: 240,
          opp_pts: 205,
          pts_g: 80,
          opp_g: 68.3,
          total_g: 148.3,
          pace: 70.1,
          fga: 180,
          fta: 60,
          orb: 30,
          tov: 34,
          mp: 120,
          fg: 85,
          fg3: 24,
          fg3a: 68,
          ft: 46,
          opp_fg: 72,
          opp_fga: 175,
          opp_fg3: 20,
          opp_fg3a: 60,
          opp_ft: 41,
          opp_fta: 55,
          opp_orb: 25,
          opp_tov: 39,
        },
        away: {
          g: 3,
          srs: null,
          sos: null,
          pts: 210,
          opp_pts: 220,
          pts_g: 70,
          opp_g: 73.3,
          total_g: 143.3,
          pace: 67.5,
          fga: 174,
          fta: 50,
          orb: 24,
          tov: 40,
          mp: 120,
          fg: 74,
          fg3: 21,
          fg3a: 62,
          ft: 41,
          opp_fg: 79,
          opp_fga: 180,
          opp_fg3: 25,
          opp_fg3a: 66,
          opp_ft: 37,
          opp_fta: 52,
          opp_orb: 28,
          opp_tov: 33,
        },
        result: { homeScore: 79, awayScore: 68 },
      },
    ],
  };

  const summary = inspectAuditPayload(mockSchema3, 'capture-audit.json', 4096);
  assert.equal(summary.schemaVersion, 3);
  assert.equal(summary.definitionCount, 2);
  assert.equal(summary.recordCollectionKey, 'records');
  assert.equal(summary.totalRecords, 1);
  assert.equal(summary.uniqueFixtureCount, 1);
  assert.equal(summary.settledFixtureCount, 1);
  assert.equal(summary.missingSrsCount, 1);
  assert.equal(summary.receiptCount, 1);
  assert.equal(summary.missingCourtQuantVariables.length, 0);
  assert.equal(summary.dateRange.earliest, '2026-11-12T19:00:00.000Z');
});

test('inspectAuditPayload resolves per-record Schema-3 $ref pointers and camelCase teamStats', () => {
  const realStyleSchema3 = {
    schemaVersion: 3,
    records: [
      {
        fixtureKey: 'sr:match:999',
        receiptValid: true,
        definitions: {
          h_hash: {
            games: 4,
            srs: 10.2,
            sos: 2.1,
            totalPoints: 320,
            opponentPoints: 272,
            fieldGoalAttempts: 248,
            freeThrowAttempts: 84,
            offensiveRebounds: 40,
            turnovers: 48,
            mp: 160,
            fg: 112,
            fg3: 32,
            fg3a: 90,
            ft: 64,
            oppFg: 96,
            oppFga: 240,
            oppFg3: 24,
            oppFg3a: 82,
            oppFt: 56,
            oppFta: 72,
            oppOrb: 34,
            oppTov: 52,
          },
          a_hash: {
            games: 4,
            srs: 3.4,
            sos: 0.9,
            totalPoints: 288,
            opponentPoints: 284,
            fieldGoalAttempts: 236,
            freeThrowAttempts: 76,
            offensiveRebounds: 36,
            turnovers: 50,
            mp: 160,
            fg: 104,
            fg3: 28,
            fg3a: 88,
            ft: 52,
            oppFg: 100,
            oppFga: 238,
            oppFg3: 28,
            oppFg3a: 84,
            oppFt: 56,
            oppFta: 74,
            oppOrb: 38,
            oppTov: 44,
          },
        },
        analysis: {
          eventId: 'sr:match:999',
          status: 'Ended',
          homeScore: 81,
          awayScore: 70,
          kickoffIso: '2026-11-15T18:00:00Z',
          homeStats: { $ref: 'h_hash' },
          awayStats: { $ref: 'a_hash' },
        },
        receipt: {
          checksum: 'valid',
        },
      },
    ],
  };

  const summary = inspectAuditPayload(realStyleSchema3, 'capture-audit.json', 8192);
  assert.equal(summary.schemaVersion, 3);
  assert.equal(summary.settledFixtureCount, 1);
  assert.equal(summary.uniqueFixtureCount, 1);
  assert.equal(summary.missingSrsCount, 0);
  assert.equal(summary.detectedCourtQuantVariables.length, 52);
  assert.equal(summary.missingCourtQuantVariables.length, 0);
  assert.equal(summary.dateRange.earliest, '2026-11-15T18:00:00.000Z');
});

