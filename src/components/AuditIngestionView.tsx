import React, { useRef, useState } from 'react';
import { FileUp, RefreshCw, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { UploadStatusResponse } from '../lib/courtquantTypes';

interface AuditIngestionViewProps {
  status: UploadStatusResponse | null;
  loadingStatus: boolean;
  onRefreshStatus: () => Promise<void>;
  onUploadComplete: (nextStatus: UploadStatusResponse) => void;
}

const CHUNK_SIZE_BYTES = 512 * 1024; // 512 KB chunks avoid reverse-proxy payload limits

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AuditIngestionView: React.FC<AuditIngestionViewProps> = ({
  status,
  loadingStatus,
  onRefreshStatus,
  onUploadComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [schemaFilter, setSchemaFilter] = useState('');

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
    setProgressPct(0);
    setUploadedBytes(0);
    setTotalBytes(file.size);

    const uploadId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      if (!initRes.ok) {
        throw new Error('Could not initialize chunked upload session');
      }

      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));
      let sent = 0;

      for (let i = 0; i < totalChunks; i += 1) {
        const start = i * CHUNK_SIZE_BYTES;
        const end = Math.min(file.size, start + CHUNK_SIZE_BYTES);
        const slice = file.slice(start, end);
        const buf = await slice.arrayBuffer();

        const chunkRes = await fetch(
          `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buf,
          },
        );
        if (!chunkRes.ok) {
          const msg = await chunkRes.text();
          throw new Error(`Chunk ${i + 1}/${totalChunks} failed: ${msg}`);
        }

        sent += buf.byteLength;
        setUploadedBytes(sent);
        setProgressPct(Math.round(((i + 1) / totalChunks) * 95));
      }

      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, fileName: file.name }),
      });
      const completeBody = await completeRes.json();
      if (!completeRes.ok) {
        throw new Error(completeBody?.error || 'Server failed to inspect uploaded JSON');
      }

      setProgressPct(100);
      onUploadComplete({
        hasAuditFile: true,
        fileSizeBytes: completeBody.fileSizeBytes,
        updatedAtIso: new Date().toISOString(),
        summary: completeBody.summary,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleClearAudit() {
    setUploadError(null);
    try {
      const res = await fetch('/api/audit', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove audit dataset');
      onUploadComplete({
        hasAuditFile: false,
        fileSizeBytes: 0,
        updatedAtIso: null,
        summary: null,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const summary = status?.summary ?? null;
  const filteredSchema = summary
    ? summary.sampleRecordSchema.filter((f) =>
        f.path.toLowerCase().includes(schemaFilter.trim().toLowerCase()),
      )
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 text-balance">
            Capture Audit Ingestion &amp; Schema-3 Inspector
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Stream large capture-audit.json files directly to workspace disk in 512 KB chunks without entering chat context.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void onRefreshStatus()}
            disabled={loadingStatus || uploading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
          {status?.hasAuditFile && (
            <button
              type="button"
              onClick={() => void handleClearAudit()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove Dataset
            </button>
          )}
        </div>
      </div>

      {/* Chunked Dropzone */}
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
            {status?.hasAuditFile
              ? 'Replace capture-audit.json on workspace disk'
              : 'Upload capture-audit.json directly to workspace'}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Saved directly to <span className="font-mono text-xs text-slate-800">data/capture-audit.json</span> on the server.
            Only compact Schema-3 headers and CourtQuant variable coverage are extracted for inspection.
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

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {uploading ? 'Uploading Chunks...' : 'Select capture-audit.json'}
            </button>
          </div>

          {uploading && (
            <div className="mt-5 w-full max-w-md space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600 tabular-nums">
                <span>Streaming 512 KB chunks</span>
                <span>
                  {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)} ({progressPct}%)
                </span>
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

      {/* Summary & Schema Inspector */}
      {loadingStatus && !summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      )}

      {!loadingStatus && !summary && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">No training dataset on disk yet</h2>
          <p className="mt-1 text-sm text-slate-600">
            Once you drop <span className="font-mono text-xs">capture-audit.json</span> above, this workbench will parse Schema-3 content hashes,
            verify settled outcomes, map all 52 <span className="font-mono text-xs">home.*</span> / <span className="font-mono text-xs">away.*</span> variables,
            and unlock chronological out-of-sample model training against <span className="font-semibold">CCVS</span>.
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
                    No direct home.*/away.* fields matched at shallow keys; inspect the sample schema paths below to map nested paths.
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
                  Field paths and inferred JSON types across the first 50 records (no raw values exposed).
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
