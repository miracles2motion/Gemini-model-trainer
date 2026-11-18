import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Pin,
  Trash2,
} from 'lucide-react';
import type {
  BacktestDatasetSummary,
  ModelBacktestReport,
  SplitBacktestMetrics,
} from '../lib/backtestEngine';
import { evaluateModelProjections } from '../lib/courtquantEngine';
import type {
  CourtQuantModel,
  FormulaSlot,
  ModelValidationResult,
  TeamStats,
} from '../lib/courtquantTypes';
import { buildCourtQuantExportPackage } from '../lib/workspaceStorage';

interface ModelRegistryViewProps {
  models: CourtQuantModel[];
  loadingStorage: boolean;
  benchmarkAbbr: string | null;
  validationResults: Record<string, ModelValidationResult>;
  datasetSummary: BacktestDatasetSummary | null;
  reports: ModelBacktestReport[];
  onImportFiles: (files: FileList | File[]) => Promise<{
    addedCount: number;
    updatedCount: number;
    errors: string[];
  }>;
  onDeleteModel: (abbr: string) => Promise<void>;
  onSetBenchmark: (abbr: string | null) => Promise<void>;
  onCloneToSandbox: (model: CourtQuantModel) => void;
  onNavigateToIngestion: () => void;
  onNavigateToSandbox: () => void;
}

type LeaderboardSplit = 'all' | 'test' | 'train';
type LeaderboardSort = 'hit' | 'pnl' | 'roi';

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

function downloadSingleModelJson(model: CourtQuantModel) {
  const pkg = buildCourtQuantExportPackage([model]);
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
  loadingStorage,
  benchmarkAbbr,
  validationResults,
  datasetSummary,
  reports,
  onImportFiles,
  onDeleteModel,
  onSetBenchmark,
  onCloneToSandbox,
  onNavigateToIngestion,
  onNavigateToSandbox,
}) => {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [selectedAbbr, setSelectedAbbr] = useState<string>('');
  const [confirmDeleteAbbr, setConfirmDeleteAbbr] = useState<string | null>(null);
  const [split, setSplit] = useState<LeaderboardSplit>('all');
  const [sortBy, setSortBy] = useState<LeaderboardSort>('hit');

  useEffect(() => {
    if (models.length === 0) {
      setSelectedAbbr('');
      return;
    }
    if (!models.some((m) => m.abbreviation === selectedAbbr)) {
      setSelectedAbbr(models[0].abbreviation);
    }
  }, [models, selectedAbbr]);

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
    models.find((m) => m.abbreviation === selectedAbbr) ?? filteredModels[0] ?? models[0] ?? null;

  const activeValidation = activeModel ? validationResults[activeModel.abbreviation] : undefined;
  const sampleProjection = useMemo(() => {
    if (!activeModel) return null;
    return evaluateModelProjections(activeModel.formulas, REFERENCE_HOME, REFERENCE_AWAY);
  }, [activeModel]);

  const sortedReports = useMemo(() => {
    const list = [...reports];
    list.sort((a, b) => {
      const ma = a[split];
      const mb = b[split];
      if (sortBy === 'hit') {
        if (mb.p1AllHitPct !== ma.p1AllHitPct) {
          return mb.p1AllHitPct - ma.p1AllHitPct;
        }
        return mb.p1AllPnlUnits - ma.p1AllPnlUnits;
      }
      if (sortBy === 'roi') {
        if (mb.p1GateRoiPct !== ma.p1GateRoiPct) {
          return mb.p1GateRoiPct - ma.p1GateRoiPct;
        }
        return mb.p1GatePnlUnits - ma.p1GatePnlUnits;
      }
      return mb.p1GatePnlUnits - ma.p1GatePnlUnits;
    });
    return list;
  }, [reports, split, sortBy]);

  async function processFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setImporting(true);
    setImportFeedback(null);
    try {
      const result = await onImportFiles(files);
      if (result.errors.length > 0 && result.addedCount === 0 && result.updatedCount === 0) {
        setImportFeedback({
          kind: 'error',
          text: result.errors[0],
        });
      } else {
        const parts: string[] = [];
        if (result.addedCount > 0) parts.push(`${result.addedCount} added`);
        if (result.updatedCount > 0) parts.push(`${result.updatedCount} updated`);
        const summaryMsg = `Imported model package (${parts.join(', ') || 'no changes'}). Saved to browser IndexedDB.`;
        setImportFeedback({
          kind: result.errors.length > 0 ? 'error' : 'success',
          text:
            result.errors.length > 0
              ? `${summaryMsg} Warnings: ${result.errors[0]}`
              : summaryMsg,
        });
      }
    } finally {
      setImporting(false);
    }
  }

  function renderDynamicSummary() {
    if (reports.length === 0 || !datasetSummary) return null;

    const topWin = [...reports].sort(
      (a, b) => b[split].p1AllHitPct - a[split].p1AllHitPct || b[split].p1AllPnlUnits - a[split].p1AllPnlUnits,
    )[0];
    const topRoi = [...reports].sort(
      (a, b) => b[split].p1GateRoiPct - a[split].p1GateRoiPct || b[split].p1GatePnlUnits - a[split].p1GatePnlUnits,
    )[0];
    const benchmarkRep = benchmarkAbbr
      ? reports.find((r) => r.abbreviation === benchmarkAbbr) ?? null
      : null;
    const activeRep = activeModel
      ? reports.find((r) => r.abbreviation === activeModel.abbreviation) ?? reports[0]
      : reports[0];

    const w = topWin[split];
    const wWins = Math.round((w.p1AllHitPct / 100) * w.p1AllCount);
    const r = topRoi[split];
    const b = benchmarkRep?.[split] ?? null;
    const bWins = b ? Math.round((b.p1AllHitPct / 100) * b.p1AllCount) : 0;
    const aAll = activeRep.all;

    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <div className="text-xs font-medium text-teal-900">
            Win-Rate Leader · {topWin.abbreviation}
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {w.p1AllCount > 0 ? `${w.p1AllHitPct.toFixed(1)}% (${wWins}/${w.p1AllCount})` : '-'}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            Unf ROI: {w.p1AllRoiPct >= 0 ? '+' : ''}{w.p1AllRoiPct.toFixed(2)}% · Gate {w.p1GateHitPct.toFixed(1)}%
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Gate ROI Leader · {topRoi.abbreviation}
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {r.p1GateCount > 0
              ? `${r.p1GateRoiPct >= 0 ? '+' : ''}${r.p1GateRoiPct.toFixed(2)}% (${r.p1GatePnlUnits >= 0 ? '+' : ''}${r.p1GatePnlUnits.toFixed(1)}u)`
              : '-'}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            {r.p1GateCount} gated picks · Top-3 {r.top3GatePnlUnits >= 0 ? '+' : ''}{r.top3GatePnlUnits.toFixed(1)}u
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            {benchmarkRep ? `Pinned Benchmark · ${benchmarkRep.abbreviation}` : 'Benchmark Baseline'}
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {b && b.p1AllCount > 0
              ? `${b.p1AllHitPct.toFixed(1)}% (${bWins}/${b.p1AllCount})`
              : 'Not Pinned'}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            {b
              ? `Gate ${b.p1GateRoiPct >= 0 ? '+' : ''}${b.p1GateRoiPct.toFixed(2)}% (${b.p1GatePnlUnits >= 0 ? '+' : ''}${b.p1GatePnlUnits.toFixed(1)}u)`
              : 'Select any model & click Set Benchmark'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Projection Accuracy · {activeRep.abbreviation}
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
            Tot {aAll.totRmse?.toFixed(3) ?? '-'} · Mar {aAll.marRmse?.toFixed(3) ?? '-'}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
            Win LL {aAll.winLogLoss?.toFixed(4) ?? '-'} · {datasetSummary.totalSettledFixtures} settled
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        className="sr-only"
        aria-label="Import CourtQuant Model JSON files"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void processFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Model Registry &amp; Backtest Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-600 tabular-nums">
            {models.length === 0
              ? 'Your workspace starts empty. Import single or multi-model CourtQuant JSON files to begin.'
              : `${models.length} model(s) saved in browser · ${datasetSummary?.totalSettledFixtures ?? 0} settled audit fixtures`}
          </p>
        </div>

        {models.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search abbreviation or name..."
              aria-label="Search models"
              className="w-full sm:w-64 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <FileUp className="h-3.5 w-3.5" />
              {importing ? 'Importing...' : 'Import Model JSON'}
            </button>
          </div>
        )}
      </div>

      {importFeedback && (
        <div
          role={importFeedback.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium ${
            importFeedback.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-teal-200 bg-teal-50 text-teal-900'
          }`}
        >
          {importFeedback.kind === 'error' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" />
          )}
          <span>{importFeedback.text}</span>
        </div>
      )}

      {loadingStorage && models.length === 0 ? (
        <div className="h-52 animate-pulse rounded-xl border border-slate-200 bg-white" />
      ) : models.length === 0 ? (
        /* Empty First-Load State */
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void processFiles(e.dataTransfer.files);
              }
            }}
            className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors ${
              dragging ? 'border-teal-700 bg-teal-50/40' : 'border-slate-300 bg-slate-50/50'
            }`}
          >
            <FileUp className="h-9 w-9 text-teal-700" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">
              Import your CourtQuant models to start
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Drop one or multiple CourtQuant <span className="font-mono text-xs">.json</span> export files here (single model or multi-model packages up to 50 models).
              Imported models persist locally in your browser until you delete or clear them in Settings.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                disabled={importing}
                onClick={() => importInputRef.current?.click()}
                className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
              >
                Import Model JSON
              </button>
              <button
                type="button"
                onClick={onNavigateToIngestion}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Import capture-audit.json
              </button>
              <button
                type="button"
                onClick={onNavigateToSandbox}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Build New Model
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {renderDynamicSummary()}

          {/* Leaderboard Table */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Chronological Backtest Leaderboard
                </h2>
                <p className="text-xs text-slate-500">
                  {datasetSummary
                    ? 'Click any model row to inspect expressions, pin as benchmark, or export JSON.'
                    : 'Import capture-audit.json in Ingestion to evaluate your imported models.'}
                </p>
              </div>

              {datasetSummary && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setSortBy('hit')}
                      className={`rounded-md px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                        sortBy === 'hit'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sort: Win Rate
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortBy('roi')}
                      className={`rounded-md px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                        sortBy === 'roi'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sort: Gate ROI
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortBy('pnl')}
                      className={`rounded-md px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                        sortBy === 'pnl'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
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
                        split === 'all'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All ({datasetSummary.totalSettledFixtures})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplit('test')}
                      className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                        split === 'test'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      OOS Test ({datasetSummary.testCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplit('train')}
                      className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                        split === 'train'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Train ({datasetSummary.trainCount})
                    </button>
                  </div>
                </div>
              )}
            </div>

            {!datasetSummary ? (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">
                  Models loaded and persisted locally. Import your <span className="font-mono text-xs text-slate-800">capture-audit.json</span> in Ingestion to score projections and market ROI.
                </p>
                <button
                  type="button"
                  onClick={onNavigateToIngestion}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
                >
                  Go to Ingestion
                </button>
              </div>
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
                      const isBenchmark = benchmarkAbbr === rep.abbreviation;
                      const isSelected = activeModel?.abbreviation === rep.abbreviation;
                      const unfWins = Math.round((m.p1AllHitPct / 100) * m.p1AllCount);
                      return (
                        <tr
                          key={rep.abbreviation}
                          onClick={() => {
                            setSelectedAbbr(rep.abbreviation);
                            setConfirmDeleteAbbr(null);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-teal-50/70'
                              : isBenchmark
                                ? 'bg-slate-50/90 hover:bg-slate-100/70'
                                : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2 pr-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            <span>{rep.abbreviation}</span>
                            {isBenchmark && (
                              <span className="ml-2 font-sans text-xs font-medium text-teal-700">
                                · Benchmark
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
                Imported Models ({filteredModels.length})
              </div>
              <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {filteredModels.map((model) => {
                  const isSelected = activeModel?.abbreviation === model.abbreviation;
                  const isValid = validationResults[model.abbreviation]?.valid ?? true;
                  const isBenchmark = benchmarkAbbr === model.abbreviation;
                  const slotCount = FORMULA_SLOTS.filter(
                    (s) => Boolean(model.formulas[s.key]),
                  ).length;

                  return (
                    <button
                      key={model.abbreviation}
                      type="button"
                      onClick={() => {
                        setSelectedAbbr(model.abbreviation);
                        setConfirmDeleteAbbr(null);
                      }}
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
                        {isBenchmark
                          ? 'Pinned Benchmark Model'
                          : model.builtIn
                            ? 'Imported Built-in Package'
                            : 'Imported Model'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Right Detail */}
            {activeModel && (
              <section className="lg:col-span-7 space-y-5 rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">
                        {activeModel.abbreviation}
                      </span>
                      {benchmarkAbbr === activeModel.abbreviation && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-teal-700">Pinned Benchmark</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        {activeValidation?.valid !== false ? (
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

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void onSetBenchmark(
                          benchmarkAbbr === activeModel.abbreviation
                            ? null
                            : activeModel.abbreviation,
                        )
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                        benchmarkAbbr === activeModel.abbreviation
                          ? 'border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Pin className="h-3.5 w-3.5" />
                      {benchmarkAbbr === activeModel.abbreviation
                        ? 'Unpin Benchmark'
                        : 'Set as Benchmark'}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadSingleModelJson(activeModel)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
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

                    {confirmDeleteAbbr !== activeModel.abbreviation ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteAbbr(activeModel.abbreviation)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            const target = activeModel.abbreviation;
                            setConfirmDeleteAbbr(null);
                            await onDeleteModel(target);
                          }}
                          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAbbr(null)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
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
                {activeModel.description && (
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="text-xs font-semibold text-slate-500">Model Documentation</h3>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                      {activeModel.description}
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
};
