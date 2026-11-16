import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateDecisionOrGate,
  evaluateModelProjections,
  validateCourtQuantModel,
} from '../src/lib/courtquantEngine.ts';
import type {
  CandidateOptionContext,
  CourtQuantModel,
  CourtQuantPackage,
  TeamStats,
} from '../src/lib/courtquantTypes.ts';

const AUDIT_PATH = path.resolve(process.cwd(), 'data/capture-audit.json');
const MODELS_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/courtquant-models__1__e8e6e8ec.json',
);

function resolveRefs(node: unknown, defs: Record<string, unknown>, depth = 0): unknown {
  if (depth > 8 || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => resolveRefs(item, defs, depth + 1));
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === 'string' && defs[obj.$ref] !== undefined) {
    return resolveRefs(defs[obj.$ref], defs, depth + 1);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'definitions') continue;
    out[k] = resolveRefs(v, defs, depth + 1);
  }
  return out;
}

function toTeamStats(raw: Record<string, unknown> | undefined | null): TeamStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = Number(raw.games ?? raw.g ?? 0);
  if (!Number.isFinite(g) || g <= 0) return null;
  const pts = Number(raw.totalPoints ?? raw.pts ?? 0);
  const opp_pts = Number(raw.opponentPoints ?? raw.opp_pts ?? 0);
  const fga = Number(raw.fieldGoalAttempts ?? raw.fga ?? 0);
  const fta = Number(raw.freeThrowAttempts ?? raw.fta ?? 0);
  const orb = Number(raw.offensiveRebounds ?? raw.orb ?? 0);
  const tov = Number(raw.turnovers ?? raw.tov ?? 0);
  const rawPace = (fga - orb + tov + 0.475 * fta) / g;
  const pace = Number.isFinite(rawPace) && rawPace >= 45 && rawPace <= 95 ? rawPace : 70;
  return {
    g,
    srs: typeof raw.srs === 'number' && Number.isFinite(raw.srs) ? raw.srs : null,
    sos: typeof raw.sos === 'number' && Number.isFinite(raw.sos) ? raw.sos : null,
    pts,
    opp_pts,
    pts_g: pts / g,
    opp_g: opp_pts / g,
    total_g: (pts + opp_pts) / g,
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

interface RawOption {
  marketId: string;
  line: number;
  odds: number;
  side: 'over' | 'under' | 'home' | 'away';
  won: boolean;
}

interface Fixture {
  fixtureKey: string;
  kickoffIso: string;
  kickoffMs: number;
  homeScore: number;
  awayScore: number;
  actualTotal: number;
  actualMargin: number;
  homeWon: boolean;
  home: TeamStats;
  away: TeamStats;
  options: RawOption[];
}

function parseLine(spec: unknown): number | null {
  if (typeof spec !== 'string') return null;
  const m = spec.match(/(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function extractOptions(markets: unknown[], hScore: number, aScore: number): RawOption[] {
  const out: RawOption[] = [];
  const total = hScore + aScore;
  const margin = hScore - aScore;
  for (const mRaw of markets) {
    if (!mRaw || typeof mRaw !== 'object') continue;
    const m = mRaw as Record<string, unknown>;
    const id = String(m.id ?? '');
    const spec = String(m.specifier ?? '');
    const outcomes = Array.isArray(m.outcomes) ? (m.outcomes as Record<string, unknown>[]) : [];
    if (id === '225' || id === '227' || id === '228') {
      const line = parseLine(spec);
      if (line === null) continue;
      const target = id === '225' ? total : id === '227' ? hScore : aScore;
      if (target === line) continue;
      for (const o of outcomes) {
        const desc = String(o.desc ?? '').toLowerCase();
        const odds = Number(o.odds ?? 0);
        if (!Number.isFinite(odds) || odds <= 1.01) continue;
        if (desc.includes('over')) out.push({ marketId: id, line, odds, side: 'over', won: target > line });
        else if (desc.includes('under')) out.push({ marketId: id, line, odds, side: 'under', won: target < line });
      }
    } else if (id === '223') {
      const line = parseLine(spec);
      if (line === null) continue;
      for (const o of outcomes) {
        const desc = String(o.desc ?? '').toLowerCase();
        const odds = Number(o.odds ?? 0);
        if (!Number.isFinite(odds) || odds <= 1.01) continue;
        const isHome = desc.includes('home') || String(o.id ?? '') === '1714';
        const isAway = desc.includes('away') || String(o.id ?? '') === '1715';
        if (!isHome && !isAway) continue;
        const diff = isHome ? margin + line : -margin - line;
        if (diff === 0) continue;
        out.push({ marketId: '223', line, odds, side: isHome ? 'home' : 'away', won: diff > 0 });
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
        out.push({ marketId: '219', line: 0, odds, side: isHome ? 'home' : 'away', won: isHome ? margin > 0 : margin < 0 });
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

function buildOptionContext(
  opt: RawOption,
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

const raw = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
const modelsPkg = JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8')) as CourtQuantPackage;

const byFixture = new Map<string, Fixture>();
for (const rec of raw.records ?? []) {
  const defs = (rec.definitions ?? {}) as Record<string, unknown>;
  const analysis = resolveRefs(rec.analysis ?? {}, defs) as Record<string, unknown>;
  const receiptPayload = resolveRefs(rec.receipt?.payload ?? {}, defs) as Record<string, unknown>;
  const status = String(analysis.status ?? '');
  const hScore = analysis.homeScore;
  const aScore = analysis.awayScore;
  if (typeof hScore !== 'number' || typeof aScore !== 'number' || hScore <= 0 || aScore <= 0 || !(status === 'Ended' || status === 'AET' || status === 'post')) continue;
  const home = toTeamStats((analysis.homeStats ?? receiptPayload.homeStats) as Record<string, unknown>);
  const away = toTeamStats((analysis.awayStats ?? receiptPayload.awayStats) as Record<string, unknown>);
  if (!home || !away) continue;
  const frozenOffer = (analysis.frozenOffer ?? receiptPayload.board ?? {}) as Record<string, unknown>;
  const markets = Array.isArray(frozenOffer.markets) ? frozenOffer.markets : [];
  const fixtureKey = String(rec.fixtureKey ?? analysis.eventId);
  const kickoffIso = String(analysis.kickoffIso ?? '');
  const kickoffMs = Date.parse(kickoffIso) || Number(analysis.capturedAtEpochMs ?? 0);
  const parsed: Fixture = {
    fixtureKey,
    kickoffIso,
    kickoffMs,
    homeScore: hScore,
    awayScore: aScore,
    actualTotal: hScore + aScore,
    actualMargin: hScore - aScore,
    homeWon: hScore > aScore,
    home,
    away,
    options: extractOptions(markets, hScore, aScore),
  };
  const prev = byFixture.get(fixtureKey);
  if (!prev || (!analysis.capturedPreTipoff === false)) {
    byFixture.set(fixtureKey, parsed);
  }
}

const fixtures = Array.from(byFixture.values()).sort((a, b) => a.kickoffMs - b.kickoffMs);
const trainRows = fixtures.filter((f) => f.kickoffIso < '2026-11-14T00:00:00Z');
const testRows = fixtures.filter((f) => f.kickoffIso >= '2026-11-14T00:00:00Z');

// 5 contiguous chronological folds
const folds: Fixture[][] = [[], [], [], [], []];
fixtures.forEach((f, idx) => {
  const foldIdx = Math.min(4, Math.floor((idx * 5) / fixtures.length));
  folds[foldIdx].push(f);
});

function evalModelOnRows(model: CourtQuantModel, rows: Fixture[], trust = 1.0) {
  let totN = 0, totSq = 0;
  let marN = 0, marSq = 0;
  let hN = 0, hSq = 0;
  let aN = 0, aSq = 0;
  let winN = 0, winLL = 0, winHit = 0;

  let p1AllN = 0, p1AllW = 0, p1AllPnL = 0;
  let p1GateN = 0, p1GateW = 0, p1GatePnL = 0, gSumOdds = 0;
  let top3GateN = 0, top3GateW = 0, top3GatePnL = 0;

  for (const f of rows) {
    const p = evaluateModelProjections(model.formulas, f.home, f.away);
    if (p.matchTotal !== null) { totN++; totSq += (p.matchTotal - f.actualTotal) ** 2; }
    if (p.handicap !== null) { marN++; marSq += (p.handicap - f.actualMargin) ** 2; }
    if (p.homeTotal !== null) { hN++; hSq += (p.homeTotal - f.homeScore) ** 2; }
    if (p.awayTotal !== null) { aN++; aSq += (p.awayTotal - f.awayScore) ** 2; }
    if (p.straightWin !== null) {
      const pr = Math.min(0.999, Math.max(0.001, p.straightWin));
      const y = f.homeWon ? 1 : 0;
      winN++;
      winLL += -(y * Math.log(pr) + (1 - y) * Math.log(1 - pr));
      if ((pr >= 0.5 && y === 1) || (pr < 0.5 && y === 0)) winHit++;
    }

    const projSib = { home: p.homeTotal, away: p.awayTotal, total: p.matchTotal, margin: p.handicap };
    const scored: Array<{ opt: RawOption; dec: number; gate: number }> = [];
    for (const o of f.options) {
      const ctx = buildOptionContext(o, p);
      if (!ctx) continue;
      const dec = evaluateDecisionOrGate(model.formulas.decision, f.home, f.away, projSib, ctx, trust).value;
      if (dec === null) continue;
      const gate = model.formulas.pickGate
        ? evaluateDecisionOrGate(model.formulas.pickGate, f.home, f.away, projSib, ctx, trust).value ?? 1
        : 1;
      scored.push({ opt: o, dec, gate });
    }
    if (scored.length === 0) continue;
    scored.sort((a, b) => b.dec - a.dec);
    const top1 = scored[0];
    p1AllN++;
    if (top1.opt.won) p1AllW++;
    p1AllPnL += top1.opt.won ? top1.opt.odds - 1 : -1;

    if (top1.gate > 0) {
      p1GateN++;
      if (top1.opt.won) p1GateW++;
      p1GatePnL += top1.opt.won ? top1.opt.odds - 1 : -1;
      gSumOdds += top1.opt.odds;

      for (const s of scored.slice(0, 3)) {
        if (s.gate <= 0) continue;
        top3GateN++;
        if (s.opt.won) top3GateW++;
        top3GatePnL += s.opt.won ? s.opt.odds - 1 : -1;
      }
    }
  }

  return {
    totRMSE: totN ? Math.sqrt(totSq / totN) : null,
    marRMSE: marN ? Math.sqrt(marSq / marN) : null,
    hRMSE: hN ? Math.sqrt(hSq / hN) : null,
    aRMSE: aN ? Math.sqrt(aSq / aN) : null,
    winLL: winN ? winLL / winN : null,
    winAcc: winN ? winHit / winN : null,
    p1AllN, p1AllHit: p1AllN ? p1AllW / p1AllN : 0, p1AllROI: p1AllN ? p1AllPnL / p1AllN : 0, p1AllPnL,
    p1GateN, p1GateHit: p1GateN ? p1GateW / p1GateN : 0, p1GateROI: p1GateN ? p1GatePnL / p1GateN : 0, p1GatePnL,
    avgOdds: p1GateN ? gSumOdds / p1GateN : 0,
    top3GateN, top3GateHit: top3GateN ? top3GateW / top3GateN : 0, top3GateROI: top3GateN ? top3GatePnL / top3GateN : 0, top3GatePnL,
  };
}

// 1. Check matchTotal options across 5-fold CV + Train + Test
const LRSV_BASE = 'max(100,min(220,20*(((home.fga+home.opp_fga)*(2*home.fg+home.fg3+2*home.opp_fg+home.opp_fg3+402.8)/(home.fga+home.opp_fga+400)+(home.fta+home.opp_fta)*(home.ft+home.opp_ft+138.8)/(home.fta+home.opp_fta+200))/max(40,home.mp)+((away.fga+away.opp_fga)*(2*away.fg+away.fg3+2*away.opp_fg+away.opp_fg3+402.8)/(away.fga+away.opp_fga+400)+(away.fta+away.opp_fta)*(away.ft+away.opp_ft+138.8)/(away.fta+away.opp_fta+200))/max(40,away.mp))-3.2))';
const TOT_CANDIDATES: Record<string, string> = {
  'CCVS_LRSV': LRSV_BASE,
  'LRSV_TOV12': LRSV_BASE.replace('-3.2))', '-3.2-12*((home.tov+home.opp_tov)/max(1,home.fga+home.opp_fga)+(away.tov+away.opp_tov)/max(1,away.fga+away.opp_fga)-0.41)))'),
  'LRSV_TOV8': LRSV_BASE.replace('-3.2))', '-3.2-8*((home.tov+home.opp_tov)/max(1,home.fga+home.opp_fga)+(away.tov+away.opp_tov)/max(1,away.fga+away.opp_fga)-0.41)))'),
  'LRSV_OFFSET4': LRSV_BASE.replace('-3.2))', '-4.0))'),
  'LRSV_SHRINK900': 'max(100,min(220,20*(((home.fga+home.opp_fga)*(2*home.fg+home.fg3+2*home.opp_fg+home.opp_fg3+906.3)/(home.fga+home.opp_fga+900)+(home.fta+home.opp_fta)*(home.ft+home.opp_ft+277.6)/(home.fta+home.opp_fta+400))/max(40,home.mp)+((away.fga+away.opp_fga)*(2*away.fg+away.fg3+2*away.opp_fg+away.opp_fg3+906.3)/(away.fga+away.opp_fga+900)+(away.fta+away.opp_fta)*(away.ft+away.opp_ft+277.6)/(away.fta+away.opp_fta+400))/max(40,away.mp))-3.2))',
};

const ccvs = modelsPkg.models.find((m) => m.abbreviation === 'CCVS')!;
console.log('=== MATCH TOTAL 5-FOLD CV + TRAIN/TEST ===');
for (const [name, expr] of Object.entries(TOT_CANDIDATES)) {
  const m: CourtQuantModel = { ...ccvs, formulas: { ...ccvs.formulas, matchTotal: expr } };
  const foldRmses = folds.map((fold) => evalModelOnRows(m, fold).totRMSE!.toFixed(2));
  const tr = evalModelOnRows(m, trainRows).totRMSE!.toFixed(3);
  const te = evalModelOnRows(m, testRows).totRMSE!.toFixed(3);
  const all = evalModelOnRows(m, fixtures).totRMSE!.toFixed(3);
  console.log(`${name.padEnd(16)} | ALL=${all} TR=${tr} TE=${te} | Folds=[${foldRmses.join(', ')}]`);
}

// 2. Compare Handicap + StraightWin across 5-fold CV
const HC_CCVS = ccvs.formulas.handicap!;
const HC_PACE = 'max(-45,min(45,(5.2+0.44*(home.srs-away.srs)-0.24*(home.sos-away.sos))*(1+0.008*((home.pace+away.pace)/2-70))))';
const HC_PACE06 = 'max(-45,min(45,(5.2+0.44*(home.srs-away.srs)-0.24*(home.sos-away.sos))*(1+0.006*((home.pace+away.pace)/2-70))))';
console.log('\n=== HANDICAP 5-FOLD CV + TRAIN/TEST ===');
for (const [name, expr] of [['HC_CCVS', HC_CCVS], ['HC_PACE08', HC_PACE], ['HC_PACE06', HC_PACE06]] as const) {
  const m: CourtQuantModel = { ...ccvs, formulas: { ...ccvs.formulas, handicap: expr } };
  const foldRmses = folds.map((fold) => evalModelOnRows(m, fold).marRMSE!.toFixed(2));
  const tr = evalModelOnRows(m, trainRows).marRMSE!.toFixed(3);
  const te = evalModelOnRows(m, testRows).marRMSE!.toFixed(3);
  const all = evalModelOnRows(m, fixtures).marRMSE!.toFixed(3);
  console.log(`${name.padEnd(16)} | ALL=${all} TR=${tr} TE=${te} | Folds=[${foldRmses.join(', ')}]`);
}

const SW_CCVS = ccvs.formulas.straightWin!;
const SW_320 = 'min(0.98,max(0.02,0.5+0.50*proj.margin/sqrt(320+pow(proj.margin,2))))';
console.log('\n=== STRAIGHT WIN 5-FOLD CV + TRAIN/TEST ===');
for (const [name, expr] of [['SW_CCVS', SW_CCVS], ['SW_320', SW_320]] as const) {
  const m: CourtQuantModel = { ...ccvs, formulas: { ...ccvs.formulas, handicap: HC_PACE, straightWin: expr } };
  const foldLLs = folds.map((fold) => evalModelOnRows(m, fold).winLL!.toFixed(4));
  const tr = evalModelOnRows(m, trainRows).winLL!.toFixed(4);
  const te = evalModelOnRows(m, testRows).winLL!.toFixed(4);
  const all = evalModelOnRows(m, fixtures).winLL!.toFixed(4);
  console.log(`${name.padEnd(16)} | ALL=${all} TR=${tr} TE=${te} | Folds=[${foldLLs.join(', ')}]`);
}

// 3. Test high-performing AST Decision AI + Pick Gate variants!
// Recall why train-champion.ts hit +21.1% ROI / +40.1u (Train +34.5% / Test +14.3%):
// In train-champion:
// - calP = opt.implied_prob + wModelEdge * min(edgeCap, max(-0.12, opt.prob - opt.implied_prob))
//        + underTiltTot * isTotUnder + underTiltHome * isHomeUnder + awayHcapTilt * isAwayCover
// - penalty specifically on Home handicap (NOT away handicap):
//   Note in AST: isHomeHcap = opt.is_handicap * min(1, max(0, 4*(proj.margin+opt.line)*(opt.prob-0.5)))
//   Wait: check that expression carefully!
//   When market=223, Home cover has edge = proj.margin + opt.line, and edge > 0 <=> prob > 0.5!
//   So (proj.margin + opt.line) * (opt.prob - 0.5) >= 0 ALWAYS for Home cover, and <= 0 ALWAYS for Away cover!
//   Wait: what if edge == 0 exactly? Virtually never, or tiny sign.
//   So: homeSpreadIndicator = opt.is_handicap * max(0, min(1, 8*(proj.margin+opt.line)*(opt.prob-0.5))) -> 1 on Home spread, 0 on Away spread!
//   And awaySpreadIndicator = opt.is_handicap * max(0, min(1, -8*(proj.margin+opt.line)*(opt.prob-0.5))) -> 1 on Away spread, 0 on Home spread!
//   Even simpler: signedAwayCover = opt.is_handicap * min(1, max(-1, -8*(proj.margin+opt.line)*(opt.prob-0.5))) -> +1 Away, -1 Home!
//
// Let's also check soft step for Under Total:
//   isTotUnder = opt.is_total * min(1, max(-1, 8*(opt.line - proj.total))) -> +1 for Under, -1 for Over!
//   isHomeUnder = opt.is_home_total * min(1, max(-1, 8*(opt.line - proj.home))) -> +1 for Home Under, -1 for Home Over!

function makeChampion(abbr: string, cfg: {
  matchTotal: string;
  wEdge: number;
  edgeCap: number;
  uTot: number;
  uHome: number;
  uAway: number;
  awayHcap: number;
  evW: number;
  bTot: number;
  pAwayTot: number;
  pHomeHcap: number;
  pWin: number;
  minOdds: number;
  maxOdds: number;
  gateEv: number;
}): CourtQuantModel {
  const calP = `(opt.implied_prob+${cfg.wEdge}*model.trust*min(${cfg.edgeCap},max(-0.12,opt.prob-opt.implied_prob))+${cfg.uTot}*opt.is_total*min(1,max(-1,8*(opt.line-proj.total)))+${cfg.uHome}*opt.is_home_total*min(1,max(-1,8*(opt.line-proj.home)))+${cfg.uAway}*opt.is_away_total*min(1,max(-1,8*(opt.line-proj.away)))+${cfg.awayHcap}*opt.is_handicap*min(1,max(-1,-8*(proj.margin+opt.line)*(opt.prob-0.5))))`;
  const homeHcapInd = `opt.is_handicap*max(0,min(1,8*(proj.margin+opt.line)*(opt.prob-0.5)))`;
  const dec = `${(1 - cfg.evW).toFixed(2)}*(${calP}-0.5)+${cfg.evW.toFixed(2)}*(${calP}*opt.odds-1)+${cfg.bTot}*opt.is_total-${cfg.pAwayTot}*opt.is_away_total-${cfg.pHomeHcap}*${homeHcapInd}-${cfg.pWin}*opt.is_win-1.5*max(0,${cfg.minOdds}-opt.odds)-0.55*max(0,opt.odds-${cfg.maxOdds})`;
  const gate = `50*(${calP}*opt.odds-${(1 + cfg.gateEv).toFixed(3)})-30*max(0,${(cfg.minOdds - 0.05).toFixed(2)}-opt.odds)-25*max(0,opt.odds-${(cfg.maxOdds + 0.12).toFixed(2)})+2*(model.trust-1)`;
  return {
    fullName: `Champion ${abbr}`,
    abbreviation: abbr,
    description: 'Candidate',
    formulas: {
      matchTotal: cfg.matchTotal,
      homeTotal: 'max(40,min(125,(proj.total+proj.margin)/2))',
      awayTotal: 'max(40,min(125,(proj.total-proj.margin)/2))',
      handicap: HC_PACE,
      straightWin: SW_320,
      decision: dec,
      pickGate: gate,
    },
  };
}

const baseCfg = { wEdge: 0.35, edgeCap: 0.20, uTot: 0.08, uHome: 0.03, uAway: 0.015, awayHcap: 0.03, evW: 0.72, bTot: 0.035, pAwayTot: 0.045, pHomeHcap: 0.055, pWin: 0.065, minOdds: 1.62, maxOdds: 2.18, gateEv: 0.045 };
const makeLrsvTov = (wf: number, wt: number, kTov: number) =>
  `max(100,min(220,20*(((home.fga+home.opp_fga)*(2*home.fg+home.fg3+2*home.opp_fg+home.opp_fg3+${(1.007 * wf).toFixed(1)})/(home.fga+home.opp_fga+${wf})+(home.fta+home.opp_fta)*(home.ft+home.opp_ft+${(0.694 * wt).toFixed(1)})/(home.fta+home.opp_fta+${wt}))/max(40,home.mp)+((away.fga+away.opp_fga)*(2*away.fg+away.fg3+2*away.opp_fg+away.opp_fg3+${(1.007 * wf).toFixed(1)})/(away.fga+away.opp_fga+${wf})+(away.fta+away.opp_fta)*(away.ft+away.opp_ft+${(0.694 * wt).toFixed(1)})/(away.fta+away.opp_fta+${wt}))/max(40,away.mp))-3.2${kTov > 0 ? `-${kTov}*((home.tov+home.opp_tov)/max(1,home.fga+home.opp_fga)+(away.tov+away.opp_tov)/max(1,away.fga+away.opp_fga)-0.41)` : ''}))`;

const candidates: CourtQuantModel[] = [
  modelsPkg.models.find((m) => m.abbreviation === 'CCVS')!,
  makeChampion('QVCE3', { ...baseCfg, matchTotal: makeLrsvTov(600, 300, 3) }),
  makeChampion('QVCE', { ...baseCfg, matchTotal: makeLrsvTov(600, 300, 4) }),
  makeChampion('QVCE700', { ...baseCfg, matchTotal: makeLrsvTov(700, 350, 2) }),
];

console.log('\n=== FULL COMPARISON: ALL 17 MODELS vs CHAMPIONS ===');
for (const m of candidates) {
  const val = validateCourtQuantModel(m, { allowBuiltInReserved: true });
  const all = evalModelOnRows(m, fixtures);
  const tr = evalModelOnRows(m, trainRows);
  const te = evalModelOnRows(m, testRows);
  const foldRois = folds.map((f) => `${(evalModelOnRows(m, f).p1GateROI * 100).toFixed(1)}%`);
  const isChamp = m.abbreviation.startsWith('QT');
  if (!isChamp) {
    console.log(`${m.abbreviation.padEnd(5)} | Tot=${all.totRMSE?.toFixed(2) ?? '-'} Mar=${all.marRMSE?.toFixed(2) ?? '-'} LL=${all.winLL?.toFixed(4) ?? '-'} | P1Gate=${String(all.p1GateN).padStart(3)} ${(all.p1GateHit*100).toFixed(1)}% ROI=${(all.p1GateROI*100).toFixed(2)}% PnL=${all.p1GatePnL.toFixed(1)}u @${all.avgOdds.toFixed(2)} | Top3=${top3Str(all)}`);
    continue;
  }
  console.log(`\n[${m.abbreviation}] valid=${val.valid} totLen=${m.formulas.matchTotal?.length} decLen=${m.formulas.decision?.length} gateLen=${m.formulas.pickGate?.length}`);
  if (!val.valid) console.log('  ISSUES:', val.issues);
  console.log(`  PROJ  ALL: Tot=${all.totRMSE?.toFixed(3)} Mar=${all.marRMSE?.toFixed(3)} H=${all.hRMSE?.toFixed(3)} A=${all.aRMSE?.toFixed(3)} WinLL=${all.winLL?.toFixed(4)} WinAcc=${((all.winAcc ?? 0)*100).toFixed(1)}%`);
  console.log(`  PROJ  TR/TE: Tot=${tr.totRMSE?.toFixed(3)}/${te.totRMSE?.toFixed(3)} Mar=${tr.marRMSE?.toFixed(3)}/${te.marRMSE?.toFixed(3)} WinLL=${tr.winLL?.toFixed(4)}/${te.winLL?.toFixed(4)}`);
  console.log(`  ALL   P1All=${all.p1AllN} (${(all.p1AllHit*100).toFixed(1)}% ${(all.p1AllROI*100).toFixed(2)}% ${all.p1AllPnL.toFixed(1)}u) | P1Gate=${all.p1GateN} (${(all.p1GateHit*100).toFixed(1)}% ${(all.p1GateROI*100).toFixed(2)}% ${all.p1GatePnL.toFixed(1)}u @${all.avgOdds.toFixed(2)}) | Top3=${top3Str(all)}`);
  console.log(`  TRAIN P1Gate=${tr.p1GateN} (${(tr.p1GateHit*100).toFixed(1)}% ${(tr.p1GateROI*100).toFixed(2)}% ${tr.p1GatePnL.toFixed(1)}u) | Top3=${top3Str(tr)}`);
  console.log(`  TEST  P1Gate=${te.p1GateN} (${(te.p1GateHit*100).toFixed(1)}% ${(te.p1GateROI*100).toFixed(2)}% ${te.p1GatePnL.toFixed(1)}u) | Top3=${top3Str(te)}`);
  console.log(`  5-FOLD P1Gate ROI: [${foldRois.join(' | ')}]`);
  for (const trust of [0.68, 1.28]) {
    const trs = evalModelOnRows(m, fixtures, trust);
    console.log(`  trust=${trust}: P1Gate=${trs.p1GateN} (${(trs.p1GateHit*100).toFixed(1)}% ${(trs.p1GateROI*100).toFixed(2)}% ${trs.p1GatePnL.toFixed(1)}u)`);
  }
}

function top3Str(r: ReturnType<typeof evalModelOnRows>) {
  return `${r.top3GateN} (${(r.top3GateHit*100).toFixed(1)}% ${(r.top3GateROI*100).toFixed(2)}% ${r.top3GatePnL.toFixed(1)}u)`;
}
