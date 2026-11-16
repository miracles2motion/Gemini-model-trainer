import React, { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Download, Play, RotateCcw } from 'lucide-react';
import type { ModelBacktestReport } from '../lib/backtestEngine';
import { CHAMPION_MODEL_QVCE, CHAMPION_MODEL_QWIN } from '../lib/championModel';
import {
  evaluateModelProjections,
  validateCourtQuantModel,
} from '../lib/courtquantEngine';
import type {
  CourtQuantModel,
  CourtQuantPackage,
  FormulaSlot,
  TeamStats,
} from '../lib/courtquantTypes';

interface FormulaSandboxViewProps {
  draftModel: CourtQuantModel;
  onChangeDraft: (next: CourtQuantModel) => void;
  hasAuditDataset: boolean;
}

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

const SLOT_META: Array<{ key: FormulaSlot; label: string; hint: string }> = [
  { key: 'matchTotal', label: 'matchTotal (Market 225)', hint: 'Combined Match Over/Under (20..400)' },
  { key: 'homeTotal', label: 'homeTotal (Market 227)', hint: 'Home Team Over/Under (20..200)' },
  { key: 'awayTotal', label: 'awayTotal (Market 228)', hint: 'Away Team Over/Under (20..200)' },
  { key: 'handicap', label: 'handicap (Market 223)', hint: 'Home - Away Margin (-75..+75)' },
  { key: 'straightWin', label: 'straightWin (Market 219)', hint: 'Home Win Probability (0.001..0.999)' },
  { key: 'decision', label: 'decision (Decision AI)', hint: 'Ranks candidate options (#1/#2/#3) using opt.*' },
  { key: 'pickGate', label: 'pickGate (Match Gate)', hint: 'Optional gate (> 0 picks, <= 0 skips)' },
];

export const FormulaSandboxView: React.FC<FormulaSandboxViewProps> = ({
  draftModel,
  onChangeDraft,
  hasAuditDataset,
}) => {
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [backtesting, setBacktesting] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<{
    report: ModelBacktestReport;
    benchmarkReport: ModelBacktestReport | null;
  } | null>(null);

  const validation = useMemo(() => validateCourtQuantModel(draftModel), [draftModel]);
  const projection = useMemo(
    () => evaluateModelProjections(draftModel.formulas, SAMPLE_HOME, SAMPLE_AWAY),
    [draftModel.formulas],
  );

  function updateFormula(slot: FormulaSlot, value: string) {
    setSaveMessage(null);
    onChangeDraft({
      ...draftModel,
      formulas: {
        ...draftModel.formulas,
        [slot]: value.trim() === '' ? null : value,
      },
    });
  }

  function handleDownloadJson() {
    const pkg: CourtQuantPackage = {
      schemaVersion: 1,
      app: 'CourtQuant',
      models: [
        {
          fullName: draftModel.fullName.trim(),
          abbreviation: draftModel.abbreviation.trim(),
          description: draftModel.description,
          formulas: draftModel.formulas,
        },
      ],
    };
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draftModel.abbreviation.toLowerCase() || 'model'}-courtquant.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveToWorkspace() {
    setSaveMessage(null);
    const pkg: CourtQuantPackage = {
      schemaVersion: 1,
      app: 'CourtQuant',
      models: [
        {
          fullName: draftModel.fullName.trim(),
          abbreviation: draftModel.abbreviation.trim(),
          description: draftModel.description,
          formulas: draftModel.formulas,
        },
      ],
    };
    const res = await fetch('/api/models/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pkg),
    });
    const body = await res.json();
    if (res.ok) {
      setSaveMessage(`Saved ${draftModel.abbreviation} to workspace custom-models.json`);
    } else {
      setSaveMessage(body?.errors?.[0] || 'Validation failed');
    }
  }

  async function handleRunLiveBacktest() {
    setBacktesting(true);
    setBacktestError(null);
    try {
      const res = await fetch('/api/backtest/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftModel),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || body?.issues?.[0]?.message || 'Backtest failed');
      }
      setLiveResult({
        report: body.report,
        benchmarkReport: body.benchmarkReport ?? null,
      });
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setBacktesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            CourtQuant Formula Sandbox &amp; RFC-8259 Validator
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Edit AST expressions, run live Train/Test/5-Fold CV backtests against CCVS, and export valid Android JSON.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onChangeDraft(CHAMPION_MODEL_QWIN);
              setLiveResult(null);
              setSaveMessage(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Load QWIN Win-Rate
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeDraft(CHAMPION_MODEL_QVCE);
              setLiveResult(null);
              setSaveMessage(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Load QVCE ROI
          </button>
          <button
            type="button"
            disabled={!validation.valid || !hasAuditDataset || backtesting}
            onClick={() => void handleRunLiveBacktest()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5" />
            {backtesting ? 'Backtesting...' : 'Run Audit Backtest'}
          </button>
          <button
            type="button"
            disabled={!validation.valid}
            onClick={() => void handleSaveToWorkspace()}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Save Draft
          </button>
          <button
            type="button"
            disabled={!validation.valid}
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Download JSON
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-medium text-teal-900">
          {saveMessage}
        </div>
      )}

      {backtestError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900"
        >
          {backtestError}
        </div>
      )}

      {/* Live Backtest Comparison Panel */}
      {liveResult && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Live Backtest Result: {liveResult.report.abbreviation} vs CCVS
            </h2>
            <span className="font-mono text-xs text-slate-600 tabular-nums">
              5-Fold CV ROI:{' '}
              {liveResult.report.foldP1GateRoiPct
                .map((v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)
                .join(' | ')}
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Split</th>
                  <th className="py-2 pr-3 text-right font-medium">Tot RMSE (vs CCVS)</th>
                  <th className="py-2 pr-3 text-right font-medium">Mar RMSE (vs CCVS)</th>
                  <th className="py-2 pr-3 text-right font-medium">Win LL (vs CCVS)</th>
                  <th className="py-2 pr-3 text-right font-medium">Unf Hit % (vs CCVS)</th>
                  <th className="py-2 pr-3 text-right font-medium">Gate Picks / Hit %</th>
                  <th className="py-2 pr-3 text-right font-medium">Gate ROI (vs CCVS)</th>
                  <th className="py-2 pr-3 text-right font-medium">Top-1 PnL (vs CCVS)</th>
                  <th className="py-2 text-right font-medium">Top-3 PnL (vs CCVS)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(
                  [
                    ['all', 'All Settled (210)'],
                    ['train', 'Train < Nov 14 (70)'],
                    ['test', 'OOS Test >= Nov 14 (137)'],
                  ] as const
                ).map(([key, label]) => {
                  const d = liveResult.report[key];
                  const c = liveResult.benchmarkReport?.[key] ?? null;
                  return (
                    <tr key={key}>
                      <td className="py-2 pr-3 font-medium text-slate-900">{label}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-800">
                        {d.totRmse?.toFixed(3) ?? '-'}
                        {c?.totRmse ? ` (${c.totRmse.toFixed(3)})` : ''}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-800">
                        {d.marRmse?.toFixed(3) ?? '-'}
                        {c?.marRmse ? ` (${c.marRmse.toFixed(3)})` : ''}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-800">
                        {d.winLogLoss?.toFixed(4) ?? '-'}
                        {c?.winLogLoss ? ` (${c.winLogLoss.toFixed(4)})` : ''}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {d.p1AllHitPct.toFixed(1)}%
                        {c ? ` (${c.p1AllHitPct.toFixed(1)}%)` : ''}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-700">
                        {d.p1GateCount} ({d.p1GateHitPct.toFixed(1)}%)
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold tabular-nums text-teal-800">
                        {d.p1GateRoiPct > 0 ? '+' : ''}
                        {d.p1GateRoiPct.toFixed(2)}%
                        {c ? ` (+${c.p1GateRoiPct.toFixed(2)}%)` : ''}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {d.p1GatePnlUnits > 0 ? '+' : ''}
                        {d.p1GatePnlUnits.toFixed(1)}u
                        {c ? ` (+${c.p1GatePnlUnits.toFixed(1)}u)` : ''}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {d.top3GatePnlUnits > 0 ? '+' : ''}
                        {d.top3GatePnlUnits.toFixed(1)}u
                        {c ? ` (+${c.top3GatePnlUnits.toFixed(1)}u)` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Validation Banner */}
      <section
        className={`rounded-xl border p-4 ${
          validation.valid
            ? 'border-teal-200 bg-teal-50/50 text-teal-900'
            : 'border-red-200 bg-red-50 text-red-900'
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          {validation.valid ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-teal-700" />
              All CourtQuant syntax, scope, and dependency checks passed
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-red-600" />
              {validation.issues.length} validation issue(s) found
            </>
          )}
        </div>
        {!validation.valid && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {validation.issues.map((iss, idx) => (
              <li key={idx}>
                <span className="font-mono font-semibold">[{iss.slot}]</span> {iss.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Identity & Description */}
        <section className="lg:col-span-5 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Model Metadata</h2>

          <div>
            <label htmlFor="model-fullname" className="block text-xs font-medium text-slate-700">
              Full Name (3–60 chars)
            </label>
            <input
              id="model-fullname"
              type="text"
              value={draftModel.fullName}
              onChange={(e) => onChangeDraft({ ...draftModel, fullName: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="model-abbr" className="block text-xs font-medium text-slate-700">
              Abbreviation (1–8 uppercase, M1–M8 reserved)
            </label>
            <input
              id="model-abbr"
              type="text"
              value={draftModel.abbreviation}
              onChange={(e) =>
                onChangeDraft({ ...draftModel, abbreviation: e.target.value.toUpperCase() })
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="model-desc" className="block text-xs font-medium text-slate-700">
              Model Thesis &amp; Limitations
            </label>
            <textarea
              id="model-desc"
              rows={10}
              value={draftModel.description}
              onChange={(e) => onChangeDraft({ ...draftModel, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-900 focus:border-teal-700 focus:outline-none"
            />
          </div>

          {/* Live Test Output */}
          <div className="border-t border-slate-100 pt-4">
            <div className="text-xs font-semibold text-slate-600">
              Sample Output (Home 82.0 vs Away 73.0)
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 p-2.5">
                <dt className="text-slate-500">Match Total</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {projection.matchTotal !== null ? projection.matchTotal.toFixed(2) : 'NO DATA'}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <dt className="text-slate-500">Handicap</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {projection.handicap !== null ? projection.handicap.toFixed(2) : 'NO DATA'}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <dt className="text-slate-500">Home / Away</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {projection.homeTotal !== null ? projection.homeTotal.toFixed(1) : '-'} /{' '}
                  {projection.awayTotal !== null ? projection.awayTotal.toFixed(1) : '-'}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <dt className="text-slate-500">Home Win Prob</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {projection.straightWin !== null
                    ? `${(projection.straightWin * 100).toFixed(1)}%`
                    : 'NO DATA'}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Formula Inputs */}
        <section className="lg:col-span-7 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Formula Slots</h2>
          {SLOT_META.map(({ key, label, hint }) => {
            const val = draftModel.formulas[key] ?? '';
            return (
              <div key={key}>
                <div className="flex items-center justify-between">
                  <label htmlFor={`slot-${key}`} className="text-xs font-semibold text-slate-800">
                    {label}
                  </label>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {val.length}/2000
                  </span>
                </div>
                <p className="text-xs text-slate-500">{hint}</p>
                <textarea
                  id={`slot-${key}`}
                  rows={2}
                  value={val}
                  onChange={(e) => updateFormula(key, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 font-mono text-xs text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                />
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
};
