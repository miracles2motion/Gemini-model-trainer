import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Layers, Settings, Sliders } from 'lucide-react';
import { TopBar, type WorkspaceTab } from './components/TopBar';
import { AuditIngestionView } from './components/AuditIngestionView';
import { ModelRegistryView } from './components/ModelRegistryView';
import { FormulaSandboxView } from './components/FormulaSandboxView';
import { SettingsView } from './components/SettingsView';
import {
  backtestModel,
  summarizeBacktestDataset,
} from './lib/backtestEngine';
import { validateCourtQuantModel } from './lib/courtquantEngine';
import type {
  CourtQuantModel,
  ModelValidationResult,
} from './lib/courtquantTypes';
import {
  buildCourtQuantExportPackage,
  clearAuditDataset,
  clearSavedModelsState,
  createBlankDraftModel,
  deleteModelByAbbr,
  loadWorkspaceSnapshot,
  mergeImportedModels,
  parseAndValidateModelImport,
  resolveBenchmarkAbbr,
  saveAuditDataset,
  saveLibraryState,
  type StoredAuditDataset,
} from './lib/workspaceStorage';

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('registry');
  const [loadingStorage, setLoadingStorage] = useState(true);
  const [models, setModels] = useState<CourtQuantModel[]>([]);
  const [benchmarkAbbr, setBenchmarkAbbr] = useState<string | null>(null);
  const [auditDataset, setAuditDataset] = useState<StoredAuditDataset | null>(null);
  const [draftModel, setDraftModel] = useState<CourtQuantModel>(() => createBlankDraftModel([]));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await loadWorkspaceSnapshot();
        if (cancelled) return;
        setModels(snapshot.library.models);
        setBenchmarkAbbr(snapshot.library.benchmarkAbbr);
        setAuditDataset(snapshot.audit);
        if (snapshot.library.models.length > 0) {
          setDraftModel({
            ...snapshot.library.models[0],
            builtIn: false,
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingStorage(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validationResults = useMemo(() => {
    const map: Record<string, ModelValidationResult> = {};
    for (const m of models) {
      map[m.abbreviation] = validateCourtQuantModel(m, {
        allowBuiltInReserved: Boolean(m.builtIn),
      });
    }
    return map;
  }, [models]);

  const datasetSummary = useMemo(() => {
    if (!auditDataset || auditDataset.fixtures.length === 0) return null;
    return summarizeBacktestDataset(auditDataset.fixtures);
  }, [auditDataset]);

  const reports = useMemo(() => {
    if (!auditDataset || auditDataset.fixtures.length === 0 || models.length === 0) {
      return [];
    }
    return models.map((m) => backtestModel(m, auditDataset.fixtures, 1.0));
  }, [models, auditDataset]);

  const benchmarkModel = useMemo(() => {
    if (!benchmarkAbbr) return null;
    return models.find((m) => m.abbreviation === benchmarkAbbr) ?? null;
  }, [models, benchmarkAbbr]);

  const benchmarkReport = useMemo(() => {
    if (!benchmarkAbbr) return null;
    return reports.find((r) => r.abbreviation === benchmarkAbbr) ?? null;
  }, [reports, benchmarkAbbr]);

  const handleImportModelFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const errors: string[] = [];
      let nextModels = models;
      let totalAdded = 0;
      let totalUpdated = 0;

      for (const file of list) {
        try {
          const text = await file.text();
          const parsed = parseAndValidateModelImport(text);
          if (!parsed.valid) {
            errors.push(`${file.name}: ${parsed.errors[0] ?? 'Invalid CourtQuant package'}`);
            continue;
          }
          const merged = mergeImportedModels(nextModels, parsed.models);
          nextModels = merged.models;
          totalAdded += merged.addedCount;
          totalUpdated += merged.updatedCount;
        } catch (err) {
          errors.push(
            `${file.name}: ${err instanceof Error ? err.message : 'Could not read file'}`,
          );
        }
      }

      if (totalAdded > 0 || totalUpdated > 0) {
        const nextBenchmark = resolveBenchmarkAbbr(nextModels, benchmarkAbbr);
        setModels(nextModels);
        setBenchmarkAbbr(nextBenchmark);
        await saveLibraryState({ models: nextModels, benchmarkAbbr: nextBenchmark });
      }

      return { addedCount: totalAdded, updatedCount: totalUpdated, errors };
    },
    [models, benchmarkAbbr],
  );

  const handleDeleteModel = useCallback(
    async (abbr: string) => {
      const nextModels = deleteModelByAbbr(models, abbr);
      const nextBenchmark = resolveBenchmarkAbbr(nextModels, benchmarkAbbr);
      setModels(nextModels);
      setBenchmarkAbbr(nextBenchmark);
      await saveLibraryState({ models: nextModels, benchmarkAbbr: nextBenchmark });
    },
    [models, benchmarkAbbr],
  );

  const handleSetBenchmark = useCallback(
    async (abbr: string | null) => {
      const nextBenchmark = resolveBenchmarkAbbr(models, abbr);
      setBenchmarkAbbr(nextBenchmark);
      await saveLibraryState({ models, benchmarkAbbr: nextBenchmark });
    },
    [models],
  );

  const handleSaveDraftToLibrary = useCallback(
    async (model: CourtQuantModel) => {
      const merged = mergeImportedModels(models, [model]);
      const nextBenchmark = resolveBenchmarkAbbr(merged.models, benchmarkAbbr);
      setModels(merged.models);
      setBenchmarkAbbr(nextBenchmark);
      await saveLibraryState({ models: merged.models, benchmarkAbbr: nextBenchmark });
    },
    [models, benchmarkAbbr],
  );

  const handleSaveAuditDataset = useCallback(async (dataset: StoredAuditDataset) => {
    setAuditDataset(dataset);
    await saveAuditDataset(dataset);
  }, []);

  const handleClearAuditData = useCallback(async () => {
    setAuditDataset(null);
    await clearAuditDataset();
  }, []);

  const handleClearAllModels = useCallback(async () => {
    setModels([]);
    setBenchmarkAbbr(null);
    setDraftModel(createBlankDraftModel([]));
    await clearSavedModelsState();
  }, []);

  const handleResetWorkspace = useCallback(async () => {
    setModels([]);
    setBenchmarkAbbr(null);
    setAuditDataset(null);
    setDraftModel(createBlankDraftModel([]));
    await Promise.all([clearSavedModelsState(), clearAuditDataset()]);
  }, []);

  const handleExportLibrary = useCallback(() => {
    if (models.length === 0) return;
    const pkg = buildCourtQuantExportPackage(models);
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      models.length === 1
        ? `${models[0].abbreviation.toLowerCase()}-courtquant.json`
        : 'courtquant-models.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [models]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        modelCount={models.length}
        onSelectTab={setActiveTab}
        onExportLibrary={handleExportLibrary}
      />

      <div className="mx-auto flex max-w-[1440px] flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 border-b border-slate-200 bg-white p-4 lg:min-h-[calc(100vh-57px)] lg:w-64 lg:border-b-0 lg:border-r">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setActiveTab('registry')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                activeTab === 'registry'
                  ? 'bg-teal-50 text-teal-900'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Layers className="h-4 w-4 shrink-0 text-teal-700" />
              <span className="truncate">Model Registry ({models.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ingestion')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                activeTab === 'ingestion'
                  ? 'bg-teal-50 text-teal-900'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Database className="h-4 w-4 shrink-0 text-teal-700" />
              <span className="truncate">Ingestion &amp; Audit</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sandbox')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                activeTab === 'sandbox'
                  ? 'bg-teal-50 text-teal-900'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Sliders className="h-4 w-4 shrink-0 text-teal-700" />
              <span className="truncate">Formula Sandbox</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                activeTab === 'settings'
                  ? 'bg-teal-50 text-teal-900'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Settings className="h-4 w-4 shrink-0 text-teal-700" />
              <span className="truncate">Settings</span>
            </button>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-2">
            <div className="font-semibold text-slate-700">Browser Workspace</div>
            <div className="tabular-nums">
              {models.length > 0
                ? `${models.length} model(s) saved locally`
                : 'No models imported yet'}
            </div>
            {benchmarkAbbr && (
              <div className="font-mono text-slate-600">
                Benchmark: {benchmarkAbbr}
              </div>
            )}
            <div className="pt-1 tabular-nums">
              {auditDataset
                ? `${auditDataset.fileName} (${(auditDataset.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`
                : 'No capture audit imported'}
            </div>
            {auditDataset && (
              <div className="tabular-nums">
                {auditDataset.summary.uniqueFixtureCount} fixtures ·{' '}
                {auditDataset.fixtures.length} settled
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {activeTab === 'registry' && (
            <ModelRegistryView
              models={models}
              loadingStorage={loadingStorage}
              benchmarkAbbr={benchmarkAbbr}
              validationResults={validationResults}
              datasetSummary={datasetSummary}
              reports={reports}
              onImportFiles={handleImportModelFiles}
              onDeleteModel={handleDeleteModel}
              onSetBenchmark={handleSetBenchmark}
              onCloneToSandbox={(model) => {
                setDraftModel({
                  ...model,
                  fullName: `${model.fullName} Copy`.slice(0, 60),
                  abbreviation: model.abbreviation.startsWith('M')
                    ? `C${model.abbreviation.slice(0, 7)}`
                    : `${model.abbreviation.slice(0, 6)}2`,
                  builtIn: false,
                });
                setActiveTab('sandbox');
              }}
              onNavigateToIngestion={() => setActiveTab('ingestion')}
              onNavigateToSandbox={() => setActiveTab('sandbox')}
            />
          )}
          {activeTab === 'ingestion' && (
            <AuditIngestionView
              auditDataset={auditDataset}
              loadingStorage={loadingStorage}
              onSaveAuditDataset={handleSaveAuditDataset}
              onClearAuditDataset={handleClearAuditData}
              onNavigateToModels={() => setActiveTab('registry')}
            />
          )}
          {activeTab === 'sandbox' && (
            <FormulaSandboxView
              draftModel={draftModel}
              existingModels={models}
              benchmarkModel={benchmarkModel}
              benchmarkReport={benchmarkReport}
              auditFixtures={auditDataset?.fixtures ?? []}
              datasetSummary={datasetSummary}
              onChangeDraft={setDraftModel}
              onSaveDraftToLibrary={handleSaveDraftToLibrary}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsView
              models={models}
              benchmarkAbbr={benchmarkAbbr}
              auditDataset={auditDataset}
              onExportAllModels={handleExportLibrary}
              onClearAllModels={handleClearAllModels}
              onClearAuditData={handleClearAuditData}
              onResetWorkspace={handleResetWorkspace}
              onNavigateToIngestion={() => setActiveTab('ingestion')}
              onNavigateToModels={() => setActiveTab('registry')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
