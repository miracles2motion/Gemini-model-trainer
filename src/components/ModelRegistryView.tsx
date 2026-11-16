import React, { useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, Download } from 'lucide-react';
import type {
  BacktestDatasetSummary,
  ModelBacktestReport,
  SplitBacktestMetrics,
} from '../lib/backtestEngine';
import { evaluateModelProjections } from '../lib/courtquantEngine';
import type {
  CourtQuantModel,
  CourtQuantPackage,
  FormulaSlot,
  ModelValidationResult,
  TeamStats,
} from '../lib/courtquantTypes';

export interface BacktestApiResponse {
  hasAuditFile: boolean;
  datasetSummary: BacktestDatasetSummary | null;
  benchmarkAbbr?: string;
  championAbbr?: string;
  reports: ModelBacktestReport[];
}

interface ModelRegistryViewProps {
  models: CourtQuantModel[];
  validationResults: Record<string, ModelValidationResult>;
  backtestData: BacktestApiResponse | null;
  loadingBacktest: boolean;
  onCloneToSandbox: (model: CourtQuantModel) => void;
}

type LeaderboardSplit = 'all' | 'test' | 'train';
type LeaderboardSort = 'pnl' | 'hit';

const REFERENCE_HOME: TeamStats = {
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

const REFERENCE_AWAY: TeamStats = {
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

const FORMULA_SLOTS: Array<{ key: FormulaSlot; label: string }> = [
  { key: 'matchTotal', label: 'Match O/U (225)' },
  { key: 'homeTotal', label: 'Home Team O/U (227)' },
  { key: 'awayTotal', label: 'Away Team O/U (228)' },
  { key: 'handicap', label: 'Handicap / Spread (223)' },
  { key: 'straightWin', label: 'Straight Win (219)' },
  { key: 'decision', label: 'Decision AI Ranker' },
  { key: 'pickGate', label: 'Match Pick Gate' },
];

function downloadModelJson(model: CourtQuantModel) {
  const pkg: CourtQuantPackage = {
    schemaVersion: 1,
    app: 'CourtQuant',
    models: [
      {
        fullName: model.fullName.trim(),
        abbreviation: model.abbreviation.trim(),
        description: model.description,
        formulas: model.formulas,
      },
    ],
  };
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${model.abbreviation.toLowerCase()}-courtquant.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export const ModelRegistryView: React.FC<ModelRegistryViewProps> = ({
  models,
  validationResults,
  backtestData,
  loadingBacktest,
  onCloneToSandbox,
}) => {
  const [search, setSearch] = useState('');
  const [selectedAbbr, setSelectedAbbr] = useState<string>('QWIN');
  const [split, setSplit] = useState<LeaderboardSplit>('all');
  const [sortBy, setSortBy] = useState<LeaderboardSort>('hit');

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.abbreviation.toLowerCase().includes(q) ||
        m.fullName.toLowerCase().includes(q),
    );
  }, [models, search]);

  const activeModel =
    models.find((m) => m.abbreviation === selectedAbbr) ?? filteredModels[0] ?? models[0];

  const activeValidation = activeModel ? validationResults[activeModel.abbreviation] : undefined;
  const sampleProjection = useMemo(() => {
    if (!activeModel) return null;
    return evaluateModelProjections(activeModel.formulas, REFERENCE_HOME, REFERENCE_AWAY);
  }, [activeModel]);

  const sortedReports = useMemo(() => {
    const list = [...(backtestData?.reports ?? [])];
    list.sort((a, b) => {
      const ma = a[split];
      const mb = b[split];
      if (sortBy === 'hit') {
        if (mb.p1AllHitPct !== ma.p1AllHitPct) {
          return mb.p1AllHitPct - ma.p1AllHitPct;
        }
        return mb.p1AllPnlUnits - ma.p1AllPnlUnits;
      }
      return mb.p1GatePnlUnits - ma.p1GatePnlUnits;
    });
    return list;
  }, [backtestData, split, sortBy]);

  const qwinReport = backtestData?.reports.find((r) => r.abbreviation === 'QWIN') ?? null;
  const qvceReport = backtestData?.reports.find((r) => r.abbreviation === 'QVCE') ?? null;
  const ccvsReport = backtestData?.reports.find((r) => r.abbreviation === 'CCVS') ?? null;

  function renderDeltaSummary() {
    if (!qvceReport || !ccvsReport) return null;
    const w = qwinReport?.[split] ?? null;
    const q = qvceReport[split];
    const c = ccvsReport[split];
    const splitLabel =
      split === 'all'
        ? `All ${backtestData?.datasetSummary?.totalSettledFixtures ?? 210} Settled`
        : split === 'test'
          ? `OOS ≥ Nov 14 (${backtestData?.datasetSummary?.testCount ?? 137})`
          : `Train < Nov 14 (${backtestData?.datasetSummary?.trainCount ?? 70})`;
    const qwinWins = w ? Math.round((w.p1AllHitPct / 100) * w.p1AllCount) : 0;
    const ccvsWins = Math.round((c.p1AllHitPct / 100) * c.p1AllCount);

    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <div className="text-xs font-medium text-teal-900">
            QWIN vs CCVS · Top-1 Win Rate ({splitLabel})
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {w ? `${w.p1AllHitPct.toFixed(1)}% (${qwinWins}/${w.p1AllCount})` : '-'}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            CCVS: {c.p1AllHitPct.toFixed(1)}% ({ccvsWins}/{c.p1AllCount}) · Gate {w ? `${w.p1GateHitPct.toFixed(1)}%` : '-'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">QWIN Unfiltered &amp; Gated ROI</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {w ? `+${w.p1AllRoiPct.toFixed(2)}% / +${w.p1GateRoiPct.toFixed(2)}%` : '-'}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            CCVS: +{c.p1AllRoiPct.toFixed(2)}% / +{c.p1GateRoiPct.toFixed(2)}%
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">QVCE ROI Champion ({splitLabel})</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            +{q.p1GateRoiPct.toFixed(2)}% (+{q.p1GatePnlUnits.toFixed(1)}u)
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            Top-3: +{q.top3GatePnlUnits.toFixed(1)}u vs CCVS +{c.top3GatePnlUnits.toFixed(1)}u
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Projection Accuracy (All)</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
            Tot {qvceReport.all.totRmse?.toFixed(3)} · Mar {qvceReport.all.marRmse?.toFixed(3)}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            CCVS: {ccvsReport.all.totRmse?.toFixed(3)} / {ccvsReport.all.marRmse?.toFixed(3)} · LL {qvceReport.all.winLogLoss?.toFixed(4)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Model Registry &amp; Backtest Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {models.length} CourtQuant models benchmarked on historical SportyBet captures ({backtestData?.datasetSummary?.totalSettledFixtures ?? 0} settled games).
          </p>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search abbreviation or name..."
          aria-label="Search models"
          className="w-full sm:w-72 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
        />
      </div>

      {renderDeltaSummary()}

      {/* Leaderboard Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Chronological Benchmark Leaderboard (Click row to inspect)
            </h2>
            <p className="text-xs text-slate-500">
              Toggle sort by unfiltered Top-1 Win Rate (matches Android Models Studio) or gated Top-1 net units.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSortBy('hit')}
                className={`rounded-md px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  sortBy === 'hit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sort: Win Rate
              </button>
              <button
                type="button"
                onClick={() => setSortBy('pnl')}
                className={`rounded-md px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  sortBy === 'pnl' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sort: Net Profit
              </button>
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSplit('all')}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  split === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({backtestData?.datasetSummary?.totalSettledFixtures ?? '-'})
              </button>
              <button
                type="button"
                onClick={() => setSplit('test')}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  split === 'test' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                OOS Test ({backtestData?.datasetSummary?.testCount ?? '-'})
              </button>
              <button
                type="button"
                onClick={() => setSplit('train')}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  split === 'train' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Train ({backtestData?.datasetSummary?.trainCount ?? '-'})
              </button>
            </div>
          </div>
        </div>

        {loadingBacktest ? (
          <div className="mt-4 h-40 animate-pulse rounded-lg bg-slate-100" />
        ) : sortedReports.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Upload capture-audit.json in Ingestion &amp; Audit to populate live benchmark metrics.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 text-right font-medium">Tot RMSE</th>
                  <th className="py-2 pr-3 text-right font-medium">Mar RMSE</th>
                  <th className="py-2 pr-3 text-right font-medium">Win LL</th>
                  <th className="py-2 pr-3 text-right font-medium">Unf Hit %</th>
                  <th className="py-2 pr-3 text-right font-medium">Unf ROI</th>
                  <th className="py-2 pr-3 text-right font-medium">Gated Picks</th>
                  <th className="py-2 pr-3 text-right font-medium">Gate Hit %</th>
                  <th className="py-2 pr-3 text-right font-medium">Gate ROI</th>
                  <th className="py-2 pr-3 text-right font-medium">Top-1 PnL</th>
                  <th className="py-2 pr-3 text-right font-medium">Top-3 PnL</th>
                  <th className="py-2 text-right font-medium">5-Fold CV ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedReports.map((rep) => {
                  const m: SplitBacktestMetrics = rep[split];
                  const isQwin = rep.abbreviation === 'QWIN';
                  const isQvce = rep.abbreviation === 'QVCE';
                  const isCcvs = rep.abbreviation === 'CCVS';
                  const isSelected = selectedAbbr === rep.abbreviation;
                  const unfWins = Math.round((m.p1AllHitPct / 100) * m.p1AllCount);
                  return (
                    <tr
                      key={rep.abbreviation}
                      onClick={() => setSelectedAbbr(rep.abbreviation)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-teal-50/70'
                          : isQwin || isQvce
                            ? 'bg-teal-50/30 hover:bg-teal-50/60'
                            : isCcvs
                              ? 'bg-slate-50/90 hover:bg-slate-100/70'
                              : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {rep.abbreviation}
                        {isQwin && (
                          <span className="ml-2 rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-teal-800">
                            WIN CHAMPION
                          </span>
                        )}
                        {isQvce && (
                          <span className="ml-2 rounded border border-teal-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-teal-800">
                            ROI CHAMPION
                          </span>
                        )}
                        {isCcvs && (
                          <span className="ml-2 rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-700">
                            BENCHMARK
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-700 tabular-nums">
                        {m.totRmse !== null ? m.totRmse.toFixed(2) : '-'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-700 tabular-nums">
                        {m.marRmse !== null ? m.marRmse.toFixed(2) : '-'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-700 tabular-nums">
                        {m.winLogLoss !== null ? m.winLogLoss.toFixed(4) : '-'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {m.p1AllCount > 0 ? `${m.p1AllHitPct.toFixed(1)}% (${unfWins}/${m.p1AllCount})` : '-'}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-mono tabular-nums ${
                          m.p1AllRoiPct > 0
                            ? 'text-teal-800'
                            : m.p1AllRoiPct < 0
                              ? 'text-red-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {m.p1AllCount > 0
                          ? `${m.p1AllRoiPct > 0 ? '+' : ''}${m.p1AllRoiPct.toFixed(2)}%`
                          : '-'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-700 tabular-nums">
                        {m.p1GateCount}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-700 tabular-nums">
                        {m.p1GateCount > 0 ? `${m.p1GateHitPct.toFixed(1)}%` : '-'}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-mono font-semibold tabular-nums ${
                          m.p1GateRoiPct > 0
                            ? 'text-teal-800'
                            : m.p1GateRoiPct < 0
                              ? 'text-red-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {m.p1GateCount > 0
                          ? `${m.p1GateRoiPct > 0 ? '+' : ''}${m.p1GateRoiPct.toFixed(2)}%`
                          : '-'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {m.p1GateCount > 0
                          ? `${m.p1GatePnlUnits > 0 ? '+' : ''}${m.p1GatePnlUnits.toFixed(1)}u`
                          : '-'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-800 tabular-nums">
                        {m.top3GateCount > 0
                          ? `${m.top3GatePnlUnits > 0 ? '+' : ''}${m.top3GatePnlUnits.toFixed(1)}u`
                          : '-'}
                      </td>
                      <td className="py-2 text-right font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                        {rep.foldP1GateRoiPct.map((v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`).join(' / ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left List */}
        <section className="lg:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-500">
            Models ({filteredModels.length})
          </div>
          <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
            {filteredModels.map((model) => {
              const isSelected = activeModel?.abbreviation === model.abbreviation;
              const isValid = validationResults[model.abbreviation]?.valid ?? true;
              const slotCount = FORMULA_SLOTS.filter(
                (s) => Boolean(model.formulas[s.key]),
              ).length;

              return (
                <button
                  key={model.abbreviation}
                  type="button"
                  onClick={() => setSelectedAbbr(model.abbreviation)}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    isSelected ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      {model.abbreviation}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {slotCount} slots · {isValid ? 'Valid' : 'Error'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-slate-800 truncate">
                    {model.fullName}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {model.abbreviation === 'QWIN'
                      ? 'Trained Win-Rate Champion'
                      : model.abbreviation === 'QVCE'
                        ? 'Trained ROI Champion'
                        : model.abbreviation === 'CCVS'
                          ? 'Previous Benchmark Model'
                          : model.builtIn
                            ? 'Built-in Baseline'
                            : 'Custom Research Model'}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Right Detail */}
        {activeModel && (
          <section className="lg:col-span-7 space-y-5 rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-800">
                    {activeModel.abbreviation}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeModel.abbreviation === 'QWIN'
                      ? 'Win-Rate Champion'
                      : activeModel.abbreviation === 'QVCE'
                        ? 'ROI Champion'
                        : activeModel.abbreviation === 'CCVS'
                          ? 'Prior Benchmark'
                          : activeModel.builtIn
                            ? 'Built-in Read-Only'
                            : 'User / Imported'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-slate-700">
                    {activeValidation?.valid ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-teal-700" />
                        Syntax Verified
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                        Validation Error
                      </>
                    )}
                  </span>
                </div>
                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  {activeModel.fullName}
                </h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadModelJson(activeModel)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => onCloneToSandbox(activeModel)}
                  className="rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
                >
                  Clone to Sandbox
                </button>
              </div>
            </div>

            {/* Live Reference Matchup Evaluation */}
            {sampleProjection && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500">
                  Reference Matchup Sanity Check (Home 82.0 pts/g, SRS +12.4 vs Away 73.0 pts/g, SRS +4.2)
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Match Total</div>
                    <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {sampleProjection.matchTotal !== null
                        ? sampleProjection.matchTotal.toFixed(1)
                        : 'N/A'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Home Total</div>
                    <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {sampleProjection.homeTotal !== null
                        ? sampleProjection.homeTotal.toFixed(1)
                        : 'N/A'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Away Total</div>
                    <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {sampleProjection.awayTotal !== null
                        ? sampleProjection.awayTotal.toFixed(1)
                        : 'N/A'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Handicap</div>
                    <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {sampleProjection.handicap !== null
                        ? (sampleProjection.handicap >= 0 ? '+' : '') +
                          sampleProjection.handicap.toFixed(1)
                        : 'N/A'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Home Win %</div>
                    <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {sampleProjection.straightWin !== null
                        ? `${(sampleProjection.straightWin * 100).toFixed(1)}%`
                        : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Formulas */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-500">Formula Expressions</h3>
              {FORMULA_SLOTS.map(({ key, label }) => {
                const expr = activeModel.formulas[key];
                return (
                  <div key={key} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800">{label}</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {expr ? `${expr.length}/2000 chars` : 'null'}
                      </span>
                    </div>
                    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-slate-800">
                      {expr ?? 'null'}
                    </pre>
                  </div>
                );
              })}
            </div>

            {/* Description */}
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-500">Model Documentation</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {activeModel.description}
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
