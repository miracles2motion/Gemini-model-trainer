import React, { useState } from 'react';
import { Download, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { CourtQuantModel } from '../lib/courtquantTypes';
import type { StoredAuditDataset } from '../lib/workspaceStorage';

interface SettingsViewProps {
  models: CourtQuantModel[];
  benchmarkAbbr: string | null;
  auditDataset: StoredAuditDataset | null;
  onExportAllModels: () => void;
  onClearAllModels: () => Promise<void>;
  onClearAuditData: () => Promise<void>;
  onResetWorkspace: () => Promise<void>;
  onNavigateToIngestion: () => void;
  onNavigateToModels: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  models,
  benchmarkAbbr,
  auditDataset,
  onExportAllModels,
  onClearAllModels,
  onClearAuditData,
  onResetWorkspace,
  onNavigateToIngestion,
  onNavigateToModels,
}) => {
  const [confirmModels, setConfirmModels] = useState(false);
  const [confirmAudit, setConfirmAudit] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Workspace Settings &amp; Browser Storage
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Imported CourtQuant models and capture audit datasets are stored locally in your browser&apos;s IndexedDB.
          Nothing leaves your device or is shared across visitors.
        </p>
      </div>

      {statusMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-medium text-teal-900">
          <CheckCircle2 className="h-4 w-4 text-teal-700" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Saved Models Management */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Saved Model Library</h2>
            <p className="mt-1 text-xs text-slate-500">
              Models persist automatically across page reloads until you remove an individual model or clear your library.
            </p>

            <dl className="mt-4 divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-600">Saved models in browser</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {models.length}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-600">Pinned benchmark</dt>
                <dd className="font-mono text-xs text-slate-900">
                  {benchmarkAbbr ?? 'None'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={models.length === 0}
              onClick={onExportAllModels}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export All Models
            </button>

            {models.length === 0 ? (
              <button
                type="button"
                onClick={onNavigateToModels}
                className="rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
              >
                Import Model JSON
              </button>
            ) : !confirmModels ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmModels(true);
                  setStatusMessage(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear All Models
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearAllModels();
                    setConfirmModels(false);
                    setStatusMessage('Cleared all saved models from browser IndexedDB.');
                  }}
                  className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0"
                >
                  Confirm Clear ({models.length})
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmModels(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Capture Audit Dataset Management */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Captured Audit Dataset</h2>
            <p className="mt-1 text-xs text-slate-500">
              Parsed fixtures and Schema-3 summary cached locally for instant leaderboard and Sandbox backtests.
            </p>

            <dl className="mt-4 divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-600">Loaded file</dt>
                <dd className="font-mono text-xs text-slate-900 truncate max-w-[220px]">
                  {auditDataset ? auditDataset.fileName : 'None'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-600">Original file size</dt>
                <dd className="font-mono text-xs text-slate-900 tabular-nums">
                  {auditDataset ? formatBytes(auditDataset.fileSizeBytes) : '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-600">Settled fixtures</dt>
                <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                  {auditDataset ? auditDataset.fixtures.length.toLocaleString() : '0'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {!auditDataset ? (
              <button
                type="button"
                onClick={onNavigateToIngestion}
                className="rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
              >
                Import capture-audit.json
              </button>
            ) : !confirmAudit ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmAudit(true);
                  setStatusMessage(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Audit Data
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearAuditData();
                    setConfirmAudit(false);
                    setStatusMessage('Cleared captured audit dataset from browser IndexedDB.');
                  }}
                  className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0"
                >
                  Confirm Clear Audit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAudit(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Full Reset */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Reset Entire Browser Workspace</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Permanently deletes all imported models, benchmark pins, and cached capture-audit fixtures from this browser.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!confirmResetAll ? (
            <button
              type="button"
              disabled={models.length === 0 && !auditDataset}
              onClick={() => {
                setConfirmResetAll(true);
                setStatusMessage(null);
              }}
              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              Reset Everything
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={async () => {
                  await onResetWorkspace();
                  setConfirmResetAll(false);
                  setStatusMessage('Browser workspace reset to clean empty state.');
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0"
              >
                Confirm Full Reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetAll(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
};
