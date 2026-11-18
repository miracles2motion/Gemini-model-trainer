import React, { useRef, useState } from 'react';
import { FileUp, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  createStoredAuditDataset,
  type StoredAuditDataset,
} from '../lib/workspaceStorage';

interface AuditIngestionViewProps {
  auditDataset: StoredAuditDataset | null;
  loadingStorage: boolean;
  onSaveAuditDataset: (dataset: StoredAuditDataset) => Promise<void>;
  onClearAuditDataset: () => Promise<void>;
  onNavigateToModels: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AuditIngestionView: React.FC<AuditIngestionViewProps> = ({
  auditDataset,
  loadingStorage,
  onSaveAuditDataset,
  onClearAuditDataset,
  onNavigateToModels,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [stageLabel, setStageLabel] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [schemaFilter, setSchemaFilter] = useState('');

  async function handleFile(file: File) {
    setUploadError(null);
    setConfirmClear(false);
    setProcessing(true);
    setStageLabel(`Reading ${file.name}...`);
    setProgressPct(20);

    try {
      const text = await file.text();
      setStageLabel('Parsing JSON & resolving Schema-3 $ref hashes...');
      setProgressPct(55);
      await new Promise((r) => setTimeout(r, 15));

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(
          err instanceof Error ? `Invalid JSON file: ${err.message}` : 'Invalid JSON file',
        );
      }

      setStageLabel('Extracting settled SportyBet fixtures & Market 219–228 odds...');
      setProgressPct(80);
      await new Promise((r) => setTimeout(r, 15));

      const dataset = createStoredAuditDataset(parsed, file.name, file.size);
      setStageLabel('Saving compact fixture index to browser IndexedDB...');
      setProgressPct(95);

      await onSaveAuditDataset(dataset);
      setProgressPct(100);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to parse audit JSON');
    } finally {
      setProcessing(false);
      setStageLabel('');
    }
  }

  const summary = auditDataset?.summary ?? null;
  const filteredSchema = summary
    ? summary.sampleRecordSchema.filter((f) =>
        f.path.toLowerCase().includes(schemaFilter.trim().toLowerCase()),
      )
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 text-balance">
            Capture Audit Ingestion &amp; Schema-3 Inspector
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Import your <span className="font-mono text-xs text-slate-800">capture-audit.json</span> locally in your browser.
            No server uploads or cloud storage — your dataset is persisted privately in IndexedDB.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {auditDataset && !confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={processing}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove Dataset
            </button>
          )}
          {auditDataset && confirmClear && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setConfirmClear(false);
                  await onClearAuditDataset();
                }}
                className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0"
              >
                Confirm Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Browser-Local Dropzone */}
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
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void handleFile(dropped);
          }}
          className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? 'border-teal-700 bg-teal-50/40'
              : 'border-slate-300 bg-slate-50/50'
          }`}
        >
          <FileUp className="h-8 w-8 text-teal-700" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-slate-900">
            {auditDataset
              ? 'Replace stored capture-audit.json in browser'
              : 'Import capture-audit.json into browser IndexedDB'}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Parsed directly on your device with full Schema-3 <span className="font-mono text-xs">$ref</span> dereferencing.
            Works offline and without upload limits.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Select capture-audit.json file"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) void handleFile(selected);
              e.target.value = '';
            }}
          />

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={processing}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {processing ? 'Processing Locally...' : 'Select capture-audit.json'}
            </button>
            {auditDataset && (
              <button
                type="button"
                onClick={onNavigateToModels}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                View Model Leaderboard
              </button>
            )}
          </div>

          {processing && (
            <div className="mt-5 w-full max-w-md space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600 tabular-nums">
                <span>{stageLabel || 'Parsing file...'}</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-teal-700 transition-all duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {uploadError && (
            <div
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>
      </section>

      {loadingStorage && !summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      )}

      {!loadingStorage && !summary && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">No capture audit dataset loaded yet</h2>
          <p className="mt-1 text-sm text-slate-600">
            Drop your CourtQuant <span className="font-mono text-xs">capture-audit.json</span> above to parse Schema-3 content hashes,
            extract settled SportyBet fixtures, map all 52 <span className="font-mono text-xs">home.*</span> / <span className="font-mono text-xs">away.*</span> variables,
            and backtest your imported models locally.
          </p>
        </section>
      )}

      {summary && (
        <>
          {/* KPI Strip */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">File Size</div>
              <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                {formatBytes(summary.fileSizeBytes)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Schema {summary.schemaVersion ?? 'Unknown'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">Selection Records</div>
              <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                {summary.totalRecords.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Key: {summary.recordCollectionKey ?? 'none'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">Unique Fixtures</div>
              <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                {summary.uniqueFixtureCount.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {summary.receiptCount} receipts found
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">Settled Outcomes</div>
              <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                {summary.settledFixtureCount.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {summary.missingSrsCount} missing SRS
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium text-slate-500">CourtQuant Variables</div>
              <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                {summary.detectedCourtQuantVariables.length} / 52
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {summary.definitionCount} hash definitions
              </div>
            </div>
          </section>

          {summary.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                Inspection Notes
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {summary.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Headers & Variable Coverage */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-semibold text-slate-900">Top-Level Headers &amp; Definitions</h2>
              <p className="mt-1 text-xs text-slate-500">
                Parsed from <span className="font-mono">{summary.fileName}</span> · {summary.inspectedAtIso}
              </p>

              <dl className="mt-4 divide-y divide-slate-100 text-sm">
                <div className="flex items-center justify-between py-2">
                  <dt className="text-slate-600">Top-level keys</dt>
                  <dd className="font-mono text-xs text-slate-900 text-right">
                    {summary.topLevelKeys.join(', ')}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-2">
                  <dt className="text-slate-600">Definition tables</dt>
                  <dd className="font-mono text-xs text-slate-900">
                    {summary.definitionTableKeys.length > 0
                      ? `${summary.definitionTableKeys.join(', ')} (${summary.definitionCount})`
                      : 'None detected'}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-2">
                  <dt className="text-slate-600">Date span</dt>
                  <dd className="font-mono text-xs text-slate-900 tabular-nums">
                    {summary.dateRange.earliest
                      ? `${summary.dateRange.earliest.slice(0, 10)} to ${summary.dateRange.latest?.slice(0, 10)}`
                      : 'No timestamps detected'}
                  </dd>
                </div>
                {Object.entries(summary.headerMetadata).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between py-2">
                    <dt className="font-mono text-xs text-slate-600">{k}</dt>
                    <dd className="font-mono text-xs text-slate-900">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  CourtQuant Variable Coverage
                </h2>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-800">
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-700" />
                  {summary.detectedCourtQuantVariables.length} detected
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Matched against the 52 <span className="font-mono">home.*</span> and <span className="font-mono">away.*</span> box-score &amp; SRS fields.
              </p>

              <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3 font-mono text-xs text-slate-800">
                {summary.detectedCourtQuantVariables.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {summary.detectedCourtQuantVariables.map((v) => (
                      <div key={v} className="truncate">
                        {v}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500">
                    No direct home.*/away.* fields matched; inspect the sample schema paths below.
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* Sample Record Schema Table */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Extracted Record Schema Paths
                </h2>
                <p className="text-xs text-slate-500">
                  Field paths and inferred JSON types across the first 50 records.
                </p>
              </div>
              <input
                type="search"
                value={schemaFilter}
                onChange={(e) => setSchemaFilter(e.target.value)}
                placeholder="Filter schema path..."
                aria-label="Filter schema path"
                className="w-full sm:w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-4 font-medium">Path</th>
                    <th className="py-2 pr-4 font-medium">Types</th>
                    <th className="py-2 pr-4 text-right font-medium">Sample Hits</th>
                    <th className="py-2 font-medium">Nested Keys</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSchema.map((row) => (
                    <tr key={row.path} className="hover:bg-slate-50">
                      <td className="py-2 pr-4 font-mono text-slate-900">{row.path}</td>
                      <td className="py-2 pr-4 font-mono text-slate-600">{row.types.join(' | ')}</td>
                      <td className="py-2 pr-4 text-right font-mono text-slate-700 tabular-nums">
                        {row.presentCount}
                      </td>
                      <td className="py-2 font-mono text-slate-500">
                        {row.sampleKeys ? row.sampleKeys.join(', ') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
