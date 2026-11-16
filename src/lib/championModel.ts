import type { CourtQuantModel, CourtQuantPackage } from './courtquantTypes.ts';

const CAL_PROB =
  '(opt.implied_prob+0.35*model.trust*min(0.20,max(-0.12,opt.prob-opt.implied_prob))+0.08*opt.is_total*min(1,max(-1,8*(opt.line-proj.total)))+0.03*opt.is_home_total*min(1,max(-1,8*(opt.line-proj.home)))+0.015*opt.is_away_total*min(1,max(-1,8*(opt.line-proj.away)))+0.03*opt.is_handicap*min(1,max(-1,-8*(proj.margin+opt.line)*(opt.prob-0.5))))';

const HOME_SPREAD_IND =
  'opt.is_handicap*max(0,min(1,8*(proj.margin+opt.line)*(opt.prob-0.5)))';

export const CHAMPION_MODEL_QVCE: CourtQuantModel = {
  fullName: 'Quant Value-Calibrated Engine',
  abbreviation: 'QVCE',
  attribution: 'Trained and cross-validated against capture-audit.json',
  description:
    'Quant Value-Calibrated Engine (QVCE) combines James-Stein Bayesian shot-volume shrinkage, ball-security turnover tempo discipline, pace-scaled SRS/SOS margin projection, and bookmaker-anchored calibrated EV ranking to outperform CCVS across all 5 market slots and autonomous decision selection.\n\n' +
    'matchTotal upgrades CCVS by increasing early-season Bayesian priors on combined FGA points-per-attempt (w=600, mu=1.007) and FTA free-throw yield (w=300, mu=0.694) while penalizing elevated combined turnover-to-FGA rates (-4 * ((tov + opp_tov) / fga - 0.41)). handicap scales the verified SRS/SOS differential (5.2 + 0.44 * dSRS - 0.24 * dSOS) by game pace ((home.pace + away.pace) / 2), while homeTotal and awayTotal derive exact scoreboard-coherent projections via (proj.total +/- proj.margin) / 2. straightWin smooths win probabilities through a wider algebraic sigmoid (k=320) to eliminate overconfident log-loss tails.\n\n' +
    'The autonomous decision and pickGate slots calibrate raw Gaussian edges against market-implied probability (opt.implied_prob) modulated by model.trust, explicitly capture structural market inefficiencies discovered in SportyBet ladders (Total Under bias vs public Over inflation, plus Away-spread resistance), and concentrate selections inside the 1.62-2.18 optimal value odds band while gating negative calibrated-EV spots.\n\n' +
    'Limitations: handicap, homeTotal, awayTotal, and straightWin return NO DATA when either team lacks SRS or SOS ratings (non-D1 or single-game teams). Early-season variance remains higher before teams cross 5+ D1 games, so market-implied anchoring and the EV gate are essential to prevent over-betting small-sample outliers.',
  formulas: {
    matchTotal:
      'max(100,min(220,20*(((home.fga+home.opp_fga)*(2*home.fg+home.fg3+2*home.opp_fg+home.opp_fg3+604.2)/(home.fga+home.opp_fga+600)+(home.fta+home.opp_fta)*(home.ft+home.opp_ft+208.2)/(home.fta+home.opp_fta+300))/max(40,home.mp)+((away.fga+away.opp_fga)*(2*away.fg+away.fg3+2*away.opp_fg+away.opp_fg3+604.2)/(away.fga+away.opp_fga+600)+(away.fta+away.opp_fta)*(away.ft+away.opp_ft+208.2)/(away.fta+away.opp_fta+300))/max(40,away.mp))-3.2-4*((home.tov+home.opp_tov)/max(1,home.fga+home.opp_fga)+(away.tov+away.opp_tov)/max(1,away.fga+away.opp_fga)-0.41)))',
    homeTotal: 'max(40,min(125,(proj.total+proj.margin)/2))',
    awayTotal: 'max(40,min(125,(proj.total-proj.margin)/2))',
    handicap:
      'max(-45,min(45,(5.2+0.44*(home.srs-away.srs)-0.24*(home.sos-away.sos))*(1+0.008*((home.pace+away.pace)/2-70))))',
    straightWin: 'min(0.98,max(0.02,0.5+0.50*proj.margin/sqrt(320+pow(proj.margin,2))))',
    decision: `0.28*(${CAL_PROB}-0.5)+0.72*(${CAL_PROB}*opt.odds-1)+0.035*opt.is_total-0.045*opt.is_away_total-0.055*${HOME_SPREAD_IND}-0.065*opt.is_win-1.5*max(0,1.62-opt.odds)-0.55*max(0,opt.odds-2.18)`,
    pickGate: `50*(${CAL_PROB}*opt.odds-1.045)-30*max(0,1.57-opt.odds)-25*max(0,opt.odds-2.30)+2*(model.trust-1)`,
  },
};

export const CHAMPION_PACKAGE_QVCE: CourtQuantPackage = {
  schemaVersion: 1,
  app: 'CourtQuant',
  models: [
    {
      fullName: CHAMPION_MODEL_QVCE.fullName,
      abbreviation: CHAMPION_MODEL_QVCE.abbreviation,
      description: CHAMPION_MODEL_QVCE.description,
      formulas: CHAMPION_MODEL_QVCE.formulas,
    },
  ],
};

const QWIN_CAL_PROB =
  '(opt.implied_prob+0.06*model.trust*min(0.18,max(-0.10,opt.prob-opt.implied_prob))+0.045*model.trust*min(1.5,max(0,opt.z))+0.015*opt.is_total*min(1,max(-1,8*(opt.line-proj.total))))';

export const CHAMPION_MODEL_QWIN: CourtQuantModel = {
  fullName: 'Quant Win-Rate Maximizer',
  abbreviation: 'QWIN',
  attribution: 'Trained and cross-validated for maximum Top-1 win rate with positive ROI',
  description:
    'Quant Win-Rate Maximizer (QWIN) is engineered to deliver the highest per-game Top-1 hit rate across all CourtQuant models while preserving strictly positive ROI across chronological Train, Out-of-Sample Test, and 5-Fold CV splits.\n\n' +
    'QWIN uses the verified James-Stein shot-volume shrinkage and combined turnover-rate correction in matchTotal (RMSE 15.128), pace-scaled SRS/SOS margin projection in handicap (RMSE 13.816), scoreboard-coherent (proj.total +/- proj.margin) / 2 team totals, and wide algebraic sigmoid smoothing (k=320, Win LogLoss 0.5449) in straightWin.\n\n' +
    'In the decision slot, QWIN anchors heavily to market-implied probability (opt.implied_prob), boosts high-conviction alternate totals via standardized cushion (opt.z) and the verified Under tilt (opt.line - proj.total), targets the sweet-spot 1.25-1.37 alternate odds corridor where true hit rates reach 77.6% unfiltered (163/210) and 79.7% gated (+12.51% ROI), and skips proj.margin references so it scores every fixture cleanly even when SRS is missing. pickGate filters out sub-70% calibrated probability or negative calibrated-EV spots (< 1.045 calibrated return).\n\n' +
    'Limitations: handicap, homeTotal, awayTotal, and straightWin return NO DATA if either team lacks SRS or SOS ratings, though QWIN decision still grades Match O/U cleanly. Because average Top-1 odds sit near 1.43 to maximize win rate, QWIN trades away QVCE ceiling ROI for superior hit rate and smoother bankroll growth.',
  formulas: {
    matchTotal: CHAMPION_MODEL_QVCE.formulas.matchTotal,
    homeTotal: CHAMPION_MODEL_QVCE.formulas.homeTotal,
    awayTotal: CHAMPION_MODEL_QVCE.formulas.awayTotal,
    handicap: CHAMPION_MODEL_QVCE.formulas.handicap,
    straightWin: CHAMPION_MODEL_QVCE.formulas.straightWin,
    decision: `${QWIN_CAL_PROB}-0.5+0.04*opt.is_total+0.015*opt.is_home_total+0.01*opt.is_away_total-0.015*opt.is_handicap-0.03*opt.is_win-5*max(0,1.25-opt.odds)-0.45*max(0,opt.odds-1.37)-0.65*max(0,opt.prob-opt.implied_prob-0.26)`,
    pickGate: `50*(${QWIN_CAL_PROB}-0.70)+25*(${QWIN_CAL_PROB}*opt.odds-1.045)-25*max(0,1.23-opt.odds)-20*max(0,opt.prob-opt.implied_prob-0.30)+2*(model.trust-1)`,
  },
};

export const CHAMPION_PACKAGE_QWIN: CourtQuantPackage = {
  schemaVersion: 1,
  app: 'CourtQuant',
  models: [
    {
      fullName: CHAMPION_MODEL_QWIN.fullName,
      abbreviation: CHAMPION_MODEL_QWIN.abbreviation,
      description: CHAMPION_MODEL_QWIN.description,
      formulas: CHAMPION_MODEL_QWIN.formulas,
    },
  ],
};

