import fs from 'node:fs';
import {
  backtestModel,
  extractAuditFixtures,
} from '../src/lib/backtestEngine.ts';
import { CHAMPION_MODEL_QVCE } from '../src/lib/championModel.ts';
import { validateCourtQuantModel } from '../src/lib/courtquantEngine.ts';
import type { CourtQuantModel, CourtQuantPackage } from '../src/lib/courtquantTypes.ts';

const rawAudit = JSON.parse(fs.readFileSync('data/capture-audit.json', 'utf8'));
const fixtures = extractAuditFixtures(rawAudit);

const basePkg = JSON.parse(
  fs.readFileSync('public/assets/aistudio/courtquant-models__1__e8e6e8ec.json', 'utf8'),
) as CourtQuantPackage;
const ccvs = basePkg.models.find((m) => m.abbreviation === 'CCVS')!;

const CAL_P =
  '(opt.implied_prob+0.06*model.trust*min(0.18,max(-0.10,opt.prob-opt.implied_prob))+0.045*model.trust*min(1.5,max(0,opt.z))+0.015*opt.is_total*min(1,max(-1,8*(opt.line-proj.total))))';

const decision =
  `${CAL_P}-0.5+0.04*opt.is_total+0.015*opt.is_home_total+0.01*opt.is_away_total-0.015*opt.is_handicap-0.03*opt.is_win-5*max(0,1.25-opt.odds)-0.45*max(0,opt.odds-1.37)-0.65*max(0,opt.prob-opt.implied_prob-0.26)`;

// Test pickGate thresholds for highest Gated Hit % + Gated Top-1 & Top-3 ROI
for (const minCalP of [0.66, 0.68, 0.70]) {
  for (const evFloor of [1.015, 1.03, 1.045]) {
    const pickGate = `50*(${CAL_P}-${minCalP})+25*(${CAL_P}*opt.odds-${evFloor})-25*max(0,1.23-opt.odds)-20*max(0,opt.prob-opt.implied_prob-0.30)+2*(model.trust-1)`;
    const model: CourtQuantModel = {
      fullName: 'Quant Win-Rate Maximizer',
      abbreviation: 'QWIN',
      description: 'P1.\n\nP2.\n\nP3.\n\nP4.',
      formulas: {
        matchTotal: CHAMPION_MODEL_QVCE.formulas.matchTotal,
        homeTotal: CHAMPION_MODEL_QVCE.formulas.homeTotal,
        awayTotal: CHAMPION_MODEL_QVCE.formulas.awayTotal,
        handicap: CHAMPION_MODEL_QVCE.formulas.handicap,
        straightWin: 'min(0.98,max(0.02,0.5+0.50*proj.margin/sqrt(290+pow(proj.margin,2))))',
        decision,
        pickGate,
      },
    };
    const r = backtestModel(model, fixtures, 1.0);
    console.log(
      `minCalP=${minCalP}, evFloor=${evFloor} | Gate1: ${r.all.p1GateCount} picks, ${r.all.p1GateHitPct}% hit, +${r.all.p1GateRoiPct}% ROI (+${r.all.p1GatePnlUnits}u) | Top3: ${r.all.top3GateCount} picks, ${r.all.top3GateHitPct}% hit, +${r.all.top3GateRoiPct}% (+${r.all.top3GatePnlUnits}u) | FoldsGate: [${r.foldP1GateRoiPct.join(',')}]`,
    );
  }
}

// Detailed comparison QWIN vs CCVS vs QVCE
const bestGate = `50*(${CAL_P}-0.68)+25*(${CAL_P}*opt.odds-1.03)-25*max(0,1.23-opt.odds)-20*max(0,opt.prob-opt.implied_prob-0.30)+2*(model.trust-1)`;
const qwin: CourtQuantModel = {
  fullName: 'Quant Win-Rate Maximizer',
  abbreviation: 'QWIN',
  description: 'P1.\n\nP2.\n\nP3.\n\nP4.',
  formulas: {
    matchTotal: CHAMPION_MODEL_QVCE.formulas.matchTotal,
    homeTotal: CHAMPION_MODEL_QVCE.formulas.homeTotal,
    awayTotal: CHAMPION_MODEL_QVCE.formulas.awayTotal,
    handicap: CHAMPION_MODEL_QVCE.formulas.handicap,
    straightWin: 'min(0.98,max(0.02,0.5+0.50*proj.margin/sqrt(290+pow(proj.margin,2))))',
    decision,
    pickGate: bestGate,
  },
};

console.log('\nValidation:', validateCourtQuantModel(qwin));
console.log('decision len:', decision.length, 'pickGate len:', bestGate.length);
for (const tr of [0.68, 1.0, 1.28]) {
  const rq = backtestModel(qwin, fixtures, tr);
  const wAll = Math.round((rq.all.p1AllHitPct / 100) * rq.all.p1AllCount);
  const wTe = Math.round((rq.test.p1AllHitPct / 100) * rq.test.p1AllCount);
  console.log(
    `QWIN trust=${tr} | All210: ${wAll}/${rq.all.p1AllCount} (${rq.all.p1AllHitPct}%, ROI +${rq.all.p1AllRoiPct}%, +${rq.all.p1AllPnlUnits}u) | Test137: ${wTe}/${rq.test.p1AllCount} (${rq.test.p1AllHitPct}%, +${rq.test.p1AllRoiPct}%) | Gate1: ${rq.all.p1GateCount} (${rq.all.p1GateHitPct}%, +${rq.all.p1GateRoiPct}%) | Top3: +${rq.all.top3GatePnlUnits}u`,
  );
}
const rc = backtestModel(ccvs, fixtures, 1.0);
const wcAll = Math.round((rc.all.p1AllHitPct / 100) * rc.all.p1AllCount);
const wcTe = Math.round((rc.test.p1AllHitPct / 100) * rc.test.p1AllCount);
console.log(
  `CCVS trust=1.0 | All207: ${wcAll}/${rc.all.p1AllCount} (${rc.all.p1AllHitPct}%, ROI +${rc.all.p1AllRoiPct}%, +${rc.all.p1AllPnlUnits}u) | Test137: ${wcTe}/${rc.test.p1AllCount} (${rc.test.p1AllHitPct}%, +${rc.test.p1AllRoiPct}%) | Gate1: ${rc.all.p1GateCount} (${rc.all.p1GateHitPct}%, +${rc.all.p1GateRoiPct}%) | Top3: +${rc.all.top3GatePnlUnits}u`,
);
console.log('QWIN Market Mix:', backtestModel(qwin, fixtures, 1.0).all.marketMix);
console.log('QWIN Projection RMSE/LL:', {
  totRmse: backtestModel(qwin, fixtures, 1.0).all.totRmse,
  marRmse: backtestModel(qwin, fixtures, 1.0).all.marRmse,
  winLogLoss: backtestModel(qwin, fixtures, 1.0).all.winLogLoss,
});
console.log('CCVS Projection RMSE/LL:', {
  totRmse: rc.all.totRmse,
  marRmse: rc.all.marRmse,
  winLogLoss: rc.all.winLogLoss,
});
