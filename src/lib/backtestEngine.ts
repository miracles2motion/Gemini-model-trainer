import {
  normalizeTeamStats,
  resolveSchema3Refs,
} from './auditParser.ts';
import {
  compileFormula,
  evaluateDecisionOrGate,
  evaluateModelProjections,
} from './courtquantEngine.ts';
import type {
  CandidateOptionContext,
  CourtQuantModel,
  TeamStats,
} from './courtquantTypes.ts';

export interface MarketCandidateOption {
  marketId: string;
  line: number;
  odds: number;
  side: 'over' | 'under' | 'home' | 'away';
  won: boolean;
}

export interface BacktestFixture {
  fixtureKey: string;
  kickoffIso: string;
  kickoffMs: number;
  capturedPreTipoff: boolean;
  homeScore: number;
  awayScore: number;
  actualTotal: number;
  actualMargin: number;
  homeWon: boolean;
  home: TeamStats;
  away: TeamStats;
  options: MarketCandidateOption[];
}

export interface SplitBacktestMetrics {
  fixtureCount: number;
  totCount: number;
  totRmse: number | null;
  marCount: number;
  marRmse: number | null;
  homeRmse: number | null;
  awayRmse: number | null;
  winLogLoss: number | null;
  winAccPct: number | null;
  p1AllCount: number;
  p1AllHitPct: number;
  p1AllRoiPct: number;
  p1AllPnlUnits: number;
  p1GateCount: number;
  p1GateHitPct: number;
  p1GateRoiPct: number;
  p1GatePnlUnits: number;
  p1GateAvgOdds: number;
  top3GateCount: number;
  top3GateHitPct: number;
  top3GateRoiPct: number;
  top3GatePnlUnits: number;
  marketMix: Record<string, number>;
}

export interface ModelBacktestReport {
  abbreviation: string;
  fullName: string;
  all: SplitBacktestMetrics;
  train: SplitBacktestMetrics;
  test: SplitBacktestMetrics;
  foldP1GateRoiPct: number[];
}

export interface BacktestDatasetSummary {
  totalSettledFixtures: number;
  srsCompleteFixtures: number;
  trainCount: number;
  testCount: number;
  splitCutoffIso: string;
  earliestIso: string | null;
  latestIso: string | null;
}

export const CHRONOLOGICAL_SPLIT_ISO = '2026-11-14T00:00:00Z';

function parseLineFromSpecifier(spec: unknown): number | null {
  if (typeof spec !== 'string') return null;
  const m = spec.match(/(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function extractMarketOptions(
  markets: unknown[],
  homeScore: number,
  awayScore: number,
): MarketCandidateOption[] {
  const out: MarketCandidateOption[] = [];
  const total = homeScore + awayScore;
  const margin = homeScore - awayScore;

  for (const mRaw of markets) {
    if (!mRaw || typeof mRaw !== 'object') continue;
    const m = mRaw as Record<string, unknown>;
    const id = String(m.id ?? '');
    const spec = String(m.specifier ?? '');
    const outcomes = Array.isArray(m.outcomes) ? (m.outcomes as Record<string, unknown>[]) : [];

    if (id === '225' || id === '227' || id === '228') {
      const line = parseLineFromSpecifier(spec);
      if (line === null || !Number.isFinite(line)) continue;
      const target = id === '225' ? total : id === '227' ? homeScore : awayScore;
      if (target === line) continue;
      for (const o of outcomes) {
        const desc = String(o.desc ?? '').toLowerCase();
        const odds = Number(o.odds ?? 0);
        if (!Number.isFinite(odds) || odds <= 1.01) continue;
        if (desc.includes('over')) {
          out.push({ marketId: id, line, odds, side: 'over', won: target > line });
        } else if (desc.includes('under')) {
          out.push({ marketId: id, line, odds, side: 'under', won: target < line });
        }
      }
    } else if (id === '223') {
      const line = parseLineFromSpecifier(spec);
      if (line === null || !Number.isFinite(line)) continue;
      for (const o of outcomes) {
        const desc = String(o.desc ?? '').toLowerCase();
        const odds = Number(o.odds ?? 0);
        if (!Number.isFinite(odds) || odds <= 1.01) continue;
        const isHome = desc.includes('home') || String(o.id ?? '') === '1714';
        const isAway = desc.includes('away') || String(o.id ?? '') === '1715';
        if (!isHome && !isAway) continue;
        const diff = isHome ? margin + line : -margin - line;
        if (diff === 0) continue;
        out.push({
          marketId: '223',
          line,
          odds,
          side: isHome ? 'home' : 'away',
          won: diff > 0,
        });
      }
    } else if (id === '219') {
      if (margin === 0) continue;
      for (const o of outcomes) {
        const desc = String(o.desc ?? '').toLowerCase();
        const odds = Number(o.odds ?? 0);
        if (!Number.isFinite(odds) || odds <= 1.01) continue;
        const isHome = desc.includes('home') || String(o.id ?? '') === '4';
        const isAway = desc.includes('away') || String(o.id ?? '') === '5';
        if (!isHome && !isAway) continue;
        out.push({
          marketId: '219',
          line: 0,
          odds,
          side: isHome ? 'home' : 'away',
          won: isHome ? margin > 0 : margin < 0,
        });
      }
    }
  }
  return out;
}

function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function buildCandidateOptionContext(
  opt: MarketCandidateOption,
  proj: {
    matchTotal: number | null;
    homeTotal: number | null;
    awayTotal: number | null;
    handicap: number | null;
    straightWin: number | null;
  },
): CandidateOptionContext | null {
  let edge = 0;
  let sigma = 15.0;
  let prob = 0.5;
  if (opt.marketId === '225') {
    if (proj.matchTotal === null) return null;
    edge = opt.side === 'over' ? proj.matchTotal - opt.line : opt.line - proj.matchTotal;
    sigma = 15.0;
    prob = Math.min(0.99, Math.max(0.01, normCdf(edge / sigma)));
  } else if (opt.marketId === '227') {
    if (proj.homeTotal === null) return null;
    edge = opt.side === 'over' ? proj.homeTotal - opt.line : opt.line - proj.homeTotal;
    sigma = 10.5;
    prob = Math.min(0.99, Math.max(0.01, normCdf(edge / sigma)));
  } else if (opt.marketId === '228') {
    if (proj.awayTotal === null) return null;
    edge = opt.side === 'over' ? proj.awayTotal - opt.line : opt.line - proj.awayTotal;
    sigma = 10.5;
    prob = Math.min(0.99, Math.max(0.01, normCdf(edge / sigma)));
  } else if (opt.marketId === '223') {
    if (proj.handicap === null) return null;
    edge = opt.side === 'home' ? proj.handicap + opt.line : -proj.handicap - opt.line;
    sigma = 14.0;
    prob = Math.min(0.99, Math.max(0.01, normCdf(edge / sigma)));
  } else if (opt.marketId === '219') {
    if (proj.straightWin === null) return null;
    prob = opt.side === 'home' ? proj.straightWin : 1 - proj.straightWin;
    prob = Math.min(0.99, Math.max(0.01, prob));
    edge = (prob - 1 / opt.odds) * 20;
    sigma = 14.0;
  }
  const implied_prob = 1 / opt.odds;
  return {
    edge,
    z: edge / sigma,
    prob,
    odds: opt.odds,
    implied_prob,
    ev: prob * opt.odds - 1,
    line: opt.line,
    is_total: opt.marketId === '225' ? 1 : 0,
    is_home_total: opt.marketId === '227' ? 1 : 0,
    is_away_total: opt.marketId === '228' ? 1 : 0,
    is_handicap: opt.marketId === '223' ? 1 : 0,
    is_win: opt.marketId === '219' ? 1 : 0,
  };
}

export function extractAuditFixtures(rawData: unknown): BacktestFixture[] {
  if (!rawData || typeof rawData !== 'object') return [];
  const root = rawData as Record<string, unknown>;
  const rootDefs =
    root.definitions && typeof root.definitions === 'object' && !Array.isArray(root.definitions)
      ? (root.definitions as Record<string, unknown>)
      : {};
  const records = Array.isArray(root.records) ? root.records : [];
  const byFixture = new Map<string, BacktestFixture>();

  for (const item of records) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const recDefs =
      rec.definitions && typeof rec.definitions === 'object' && !Array.isArray(rec.definitions)
        ? (rec.definitions as Record<string, unknown>)
        : {};
    const defs = { ...rootDefs, ...recDefs };
    const analysis = resolveSchema3Refs(rec.analysis ?? {}, defs) as Record<string, unknown>;
    const receiptPayload = resolveSchema3Refs(
      (rec.receipt as Record<string, unknown> | undefined)?.payload ?? {},
      defs,
    ) as Record<string, unknown>;

    const status = String(analysis.status ?? '');
    const hScore = analysis.homeScore;
    const aScore = analysis.awayScore;
    if (
      typeof hScore !== 'number' ||
      typeof aScore !== 'number' ||
      hScore <= 0 ||
      aScore <= 0 ||
      !(status === 'Ended' || status === 'AET' || status === 'post')
    ) {
      continue;
    }

    const home = normalizeTeamStats(
      (analysis.homeStats ?? receiptPayload.homeStats) as Record<string, unknown>,
    );
    const away = normalizeTeamStats(
      (analysis.awayStats ?? receiptPayload.awayStats) as Record<string, unknown>,
    );
    if (!home || !away) continue;

    const frozenOffer = (analysis.frozenOffer ?? receiptPayload.board ?? {}) as Record<
      string,
      unknown
    >;
    const markets = Array.isArray(frozenOffer.markets) ? frozenOffer.markets : [];
    const fixtureKey = String(rec.fixtureKey ?? analysis.eventId ?? byFixture.size);
    const kickoffIso = String(analysis.kickoffIso ?? receiptPayload.kickoffIso ?? '');
    const kickoffMs = Date.parse(kickoffIso) || Number(analysis.capturedAtEpochMs ?? 0);
    const capturedPreTipoff = Boolean(analysis.capturedPreTipoff);

    const parsed: BacktestFixture = {
      fixtureKey,
      kickoffIso,
      kickoffMs,
      capturedPreTipoff,
      homeScore: hScore,
      awayScore: aScore,
      actualTotal: hScore + aScore,
      actualMargin: hScore - aScore,
      homeWon: hScore > aScore,
      home,
      away,
      options: extractMarketOptions(markets, hScore, aScore),
    };

    const prev = byFixture.get(fixtureKey);
    if (!prev || (!prev.capturedPreTipoff && parsed.capturedPreTipoff)) {
      byFixture.set(fixtureKey, parsed);
    }
  }

  return Array.from(byFixture.values()).sort((a, b) => a.kickoffMs - b.kickoffMs);
}

export function evaluateModelOnSplit(
  model: CourtQuantModel,
  rows: BacktestFixture[],
  trust = 1.0,
): SplitBacktestMetrics {
  let totCount = 0;
  let totSq = 0;
  let marCount = 0;
  let marSq = 0;
  let hCount = 0;
  let hSq = 0;
  let aCount = 0;
  let aSq = 0;
  let winCount = 0;
  let winLL = 0;
  let winHits = 0;

  let p1AllCount = 0;
  let p1AllWins = 0;
  let p1AllPnl = 0;
  let p1GateCount = 0;
  let p1GateWins = 0;
  let p1GatePnl = 0;
  let gSumOdds = 0;
  let top3GateCount = 0;
  let top3GateWins = 0;
  let top3GatePnl = 0;
  const marketMix: Record<string, number> = {};

  let compiledDecision: ReturnType<typeof compileFormula> = null;
  let compiledGate: ReturnType<typeof compileFormula> = null;
  try {
    compiledDecision = compileFormula(model.formulas.decision);
  } catch {
    compiledDecision = null;
  }
  try {
    compiledGate = compileFormula(model.formulas.pickGate);
  } catch {
    compiledGate = null;
  }

  for (const f of rows) {
    const p = evaluateModelProjections(model.formulas, f.home, f.away);
    if (p.matchTotal !== null) {
      totCount += 1;
      totSq += (p.matchTotal - f.actualTotal) ** 2;
    }
    if (p.handicap !== null) {
      marCount += 1;
      marSq += (p.handicap - f.actualMargin) ** 2;
    }
    if (p.homeTotal !== null) {
      hCount += 1;
      hSq += (p.homeTotal - f.homeScore) ** 2;
    }
    if (p.awayTotal !== null) {
      aCount += 1;
      aSq += (p.awayTotal - f.awayScore) ** 2;
    }
    if (p.straightWin !== null) {
      const pr = Math.min(0.999, Math.max(0.001, p.straightWin));
      const y = f.homeWon ? 1 : 0;
      winCount += 1;
      winLL += -(y * Math.log(pr) + (1 - y) * Math.log(1 - pr));
      if ((pr >= 0.5 && y === 1) || (pr < 0.5 && y === 0)) winHits += 1;
    }

    const projSib = {
      home: p.homeTotal,
      away: p.awayTotal,
      total: p.matchTotal,
      margin: p.handicap,
    };
    const scored: Array<{ opt: MarketCandidateOption; dec: number; gate: number }> = [];
    for (const o of f.options) {
      const ctx = buildCandidateOptionContext(o, p);
      if (!ctx) continue;
      const dec = evaluateDecisionOrGate(
        model.formulas.decision,
        f.home,
        f.away,
        projSib,
        ctx,
        trust,
        compiledDecision,
      ).value;
      if (dec === null) continue;
      const gate = model.formulas.pickGate
        ? evaluateDecisionOrGate(
            model.formulas.pickGate,
            f.home,
            f.away,
            projSib,
            ctx,
            trust,
            compiledGate,
          ).value ?? 1
        : 1;
      scored.push({ opt: o, dec, gate });
    }
    if (scored.length === 0) continue;
    scored.sort((a, b) => b.dec - a.dec);

    const top1 = scored[0];
    p1AllCount += 1;
    if (top1.opt.won) p1AllWins += 1;
    p1AllPnl += top1.opt.won ? top1.opt.odds - 1 : -1;

    if (top1.gate > 0) {
      p1GateCount += 1;
      if (top1.opt.won) p1GateWins += 1;
      p1GatePnl += top1.opt.won ? top1.opt.odds - 1 : -1;
      gSumOdds += top1.opt.odds;
      const mk = `${top1.opt.marketId}_${top1.opt.side}`;
      marketMix[mk] = (marketMix[mk] ?? 0) + 1;

      for (const s of scored.slice(0, 3)) {
        if (s.gate <= 0) continue;
        top3GateCount += 1;
        if (s.opt.won) top3GateWins += 1;
        top3GatePnl += s.opt.won ? s.opt.odds - 1 : -1;
      }
    }
  }

  const r2 = (n: number) => Number(n.toFixed(2));
  const r3 = (n: number) => Number(n.toFixed(3));
  const r4 = (n: number) => Number(n.toFixed(4));

  return {
    fixtureCount: rows.length,
    totCount,
    totRmse: totCount ? r3(Math.sqrt(totSq / totCount)) : null,
    marCount,
    marRmse: marCount ? r3(Math.sqrt(marSq / marCount)) : null,
    homeRmse: hCount ? r3(Math.sqrt(hSq / hCount)) : null,
    awayRmse: aCount ? r3(Math.sqrt(aSq / aCount)) : null,
    winLogLoss: winCount ? r4(winLL / winCount) : null,
    winAccPct: winCount ? r2((winHits / winCount) * 100) : null,
    p1AllCount,
    p1AllHitPct: p1AllCount ? r2((p1AllWins / p1AllCount) * 100) : 0,
    p1AllRoiPct: p1AllCount ? r2((p1AllPnl / p1AllCount) * 100) : 0,
    p1AllPnlUnits: r2(p1AllPnl),
    p1GateCount,
    p1GateHitPct: p1GateCount ? r2((p1GateWins / p1GateCount) * 100) : 0,
    p1GateRoiPct: p1GateCount ? r2((p1GatePnl / p1GateCount) * 100) : 0,
    p1GatePnlUnits: r2(p1GatePnl),
    p1GateAvgOdds: p1GateCount ? r2(gSumOdds / p1GateCount) : 0,
    top3GateCount,
    top3GateHitPct: top3GateCount ? r2((top3GateWins / top3GateCount) * 100) : 0,
    top3GateRoiPct: top3GateCount ? r2((top3GatePnl / top3GateCount) * 100) : 0,
    top3GatePnlUnits: r2(top3GatePnl),
    marketMix,
  };
}

interface BucketAccumulator {
  fixtureCount: number;
  totCount: number;
  totSq: number;
  marCount: number;
  marSq: number;
  hCount: number;
  hSq: number;
  aCount: number;
  aSq: number;
  winCount: number;
  winLL: number;
  winHits: number;
  p1AllCount: number;
  p1AllWins: number;
  p1AllPnl: number;
  p1GateCount: number;
  p1GateWins: number;
  p1GatePnl: number;
  gSumOdds: number;
  top3GateCount: number;
  top3GateWins: number;
  top3GatePnl: number;
  marketMix: Record<string, number>;
}

function createBucket(): BucketAccumulator {
  return {
    fixtureCount: 0,
    totCount: 0,
    totSq: 0,
    marCount: 0,
    marSq: 0,
    hCount: 0,
    hSq: 0,
    aCount: 0,
    aSq: 0,
    winCount: 0,
    winLL: 0,
    winHits: 0,
    p1AllCount: 0,
    p1AllWins: 0,
    p1AllPnl: 0,
    p1GateCount: 0,
    p1GateWins: 0,
    p1GatePnl: 0,
    gSumOdds: 0,
    top3GateCount: 0,
    top3GateWins: 0,
    top3GatePnl: 0,
    marketMix: {},
  };
}

function finalizeBucket(b: BucketAccumulator): SplitBacktestMetrics {
  const r2 = (n: number) => Number(n.toFixed(2));
  const r3 = (n: number) => Number(n.toFixed(3));
  const r4 = (n: number) => Number(n.toFixed(4));
  return {
    fixtureCount: b.fixtureCount,
    totCount: b.totCount,
    totRmse: b.totCount ? r3(Math.sqrt(b.totSq / b.totCount)) : null,
    marCount: b.marCount,
    marRmse: b.marCount ? r3(Math.sqrt(b.marSq / b.marCount)) : null,
    homeRmse: b.hCount ? r3(Math.sqrt(b.hSq / b.hCount)) : null,
    awayRmse: b.aCount ? r3(Math.sqrt(b.aSq / b.aCount)) : null,
    winLogLoss: b.winCount ? r4(b.winLL / b.winCount) : null,
    winAccPct: b.winCount ? r2((b.winHits / b.winCount) * 100) : null,
    p1AllCount: b.p1AllCount,
    p1AllHitPct: b.p1AllCount ? r2((b.p1AllWins / b.p1AllCount) * 100) : 0,
    p1AllRoiPct: b.p1AllCount ? r2((b.p1AllPnl / b.p1AllCount) * 100) : 0,
    p1AllPnlUnits: r2(b.p1AllPnl),
    p1GateCount: b.p1GateCount,
    p1GateHitPct: b.p1GateCount ? r2((b.p1GateWins / b.p1GateCount) * 100) : 0,
    p1GateRoiPct: b.p1GateCount ? r2((b.p1GatePnl / b.p1GateCount) * 100) : 0,
    p1GatePnlUnits: r2(b.p1GatePnl),
    p1GateAvgOdds: b.p1GateCount ? r2(b.gSumOdds / b.p1GateCount) : 0,
    top3GateCount: b.top3GateCount,
    top3GateHitPct: b.top3GateCount ? r2((b.top3GateWins / b.top3GateCount) * 100) : 0,
    top3GateRoiPct: b.top3GateCount ? r2((b.top3GatePnl / b.top3GateCount) * 100) : 0,
    top3GatePnlUnits: r2(b.top3GatePnl),
    marketMix: b.marketMix,
  };
}

export function resolveSplitCutoffIso(fixtures: BacktestFixture[]): string {
  if (fixtures.length === 0) return CHRONOLOGICAL_SPLIT_ISO;
  const first = fixtures[0].kickoffIso;
  const last = fixtures[fixtures.length - 1].kickoffIso;
  if (first && last && first < CHRONOLOGICAL_SPLIT_ISO && last >= CHRONOLOGICAL_SPLIT_ISO) {
    return CHRONOLOGICAL_SPLIT_ISO;
  }
  const splitIdx = Math.max(1, Math.min(fixtures.length - 1, Math.floor(fixtures.length * 0.35)));
  return fixtures[splitIdx]?.kickoffIso || CHRONOLOGICAL_SPLIT_ISO;
}

export function backtestModel(
  model: CourtQuantModel,
  fixtures: BacktestFixture[],
  trust = 1.0,
): ModelBacktestReport {
  const splitCutoffIso = resolveSplitCutoffIso(fixtures);
  const allB = createBucket();
  const trainB = createBucket();
  const testB = createBucket();
  const foldBs = [createBucket(), createBucket(), createBucket(), createBucket(), createBucket()];

  let compiledDecision: ReturnType<typeof compileFormula> = null;
  let compiledGate: ReturnType<typeof compileFormula> = null;
  try {
    compiledDecision = compileFormula(model.formulas.decision);
  } catch {
    compiledDecision = null;
  }
  try {
    compiledGate = compileFormula(model.formulas.pickGate);
  } catch {
    compiledGate = null;
  }

  for (let idx = 0; idx < fixtures.length; idx += 1) {
    const f = fixtures[idx];
    const splitB = f.kickoffIso < splitCutoffIso ? trainB : testB;
    const foldIdx = Math.min(4, Math.floor((idx * 5) / Math.max(1, fixtures.length)));
    const targets = [allB, splitB, foldBs[foldIdx]];

    const p = evaluateModelProjections(model.formulas, f.home, f.away);
    const projSib = {
      home: p.homeTotal,
      away: p.awayTotal,
      total: p.matchTotal,
      margin: p.handicap,
    };
    const scored: Array<{ opt: MarketCandidateOption; dec: number; gate: number }> = [];
    for (const o of f.options) {
      const ctx = buildCandidateOptionContext(o, p);
      if (!ctx) continue;
      const dec = evaluateDecisionOrGate(
        model.formulas.decision,
        f.home,
        f.away,
        projSib,
        ctx,
        trust,
        compiledDecision,
      ).value;
      if (dec === null) continue;
      const gate = model.formulas.pickGate
        ? evaluateDecisionOrGate(
            model.formulas.pickGate,
            f.home,
            f.away,
            projSib,
            ctx,
            trust,
            compiledGate,
          ).value ?? 1
        : 1;
      scored.push({ opt: o, dec, gate });
    }
    scored.sort((a, b) => b.dec - a.dec);

    const pr = p.straightWin !== null ? Math.min(0.999, Math.max(0.001, p.straightWin)) : null;
    const y = f.homeWon ? 1 : 0;

    for (const b of targets) {
      b.fixtureCount += 1;
      if (p.matchTotal !== null) {
        b.totCount += 1;
        b.totSq += (p.matchTotal - f.actualTotal) ** 2;
      }
      if (p.handicap !== null) {
        b.marCount += 1;
        b.marSq += (p.handicap - f.actualMargin) ** 2;
      }
      if (p.homeTotal !== null) {
        b.hCount += 1;
        b.hSq += (p.homeTotal - f.homeScore) ** 2;
      }
      if (p.awayTotal !== null) {
        b.aCount += 1;
        b.aSq += (p.awayTotal - f.awayScore) ** 2;
      }
      if (pr !== null) {
        b.winCount += 1;
        b.winLL += -(y * Math.log(pr) + (1 - y) * Math.log(1 - pr));
        if ((pr >= 0.5 && y === 1) || (pr < 0.5 && y === 0)) b.winHits += 1;
      }
      if (scored.length === 0) continue;
      const top1 = scored[0];
      b.p1AllCount += 1;
      if (top1.opt.won) b.p1AllWins += 1;
      b.p1AllPnl += top1.opt.won ? top1.opt.odds - 1 : -1;

      if (top1.gate > 0) {
        b.p1GateCount += 1;
        if (top1.opt.won) b.p1GateWins += 1;
        b.p1GatePnl += top1.opt.won ? top1.opt.odds - 1 : -1;
        b.gSumOdds += top1.opt.odds;
        const mk = `${top1.opt.marketId}_${top1.opt.side}`;
        b.marketMix[mk] = (b.marketMix[mk] ?? 0) + 1;

        for (const s of scored.slice(0, 3)) {
          if (s.gate <= 0) continue;
          b.top3GateCount += 1;
          if (s.opt.won) b.top3GateWins += 1;
          b.top3GatePnl += s.opt.won ? s.opt.odds - 1 : -1;
        }
      }
    }
  }

  return {
    abbreviation: model.abbreviation,
    fullName: model.fullName,
    all: finalizeBucket(allB),
    train: finalizeBucket(trainB),
    test: finalizeBucket(testB),
    foldP1GateRoiPct: foldBs.map((fb) => finalizeBucket(fb).p1GateRoiPct),
  };
}

export function summarizeBacktestDataset(fixtures: BacktestFixture[]): BacktestDatasetSummary {
  const splitCutoffIso = resolveSplitCutoffIso(fixtures);
  const trainCount = fixtures.filter((f) => f.kickoffIso < splitCutoffIso).length;
  const testCount = fixtures.length - trainCount;
  const srsCompleteFixtures = fixtures.filter(
    (f) =>
      f.home.srs !== null &&
      f.away.srs !== null &&
      f.home.sos !== null &&
      f.away.sos !== null,
  ).length;
  return {
    totalSettledFixtures: fixtures.length,
    srsCompleteFixtures,
    trainCount,
    testCount,
    splitCutoffIso,
    earliestIso: fixtures.length > 0 ? fixtures[0].kickoffIso : null,
    latestIso: fixtures.length > 0 ? fixtures[fixtures.length - 1].kickoffIso : null,
  };
}
