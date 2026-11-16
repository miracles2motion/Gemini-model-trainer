import { useCallback, useEffect, useState } from 'react';
import { Database, Layers, Sliders } from 'lucide-react';
import { TopBar, type WorkspaceTab } from './components/TopBar';
import { AuditIngestionView } from './components/AuditIngestionView';
import {
  ModelRegistryView,
  type BacktestApiResponse,
} from './components/ModelRegistryView';
import { FormulaSandboxView } from './components/FormulaSandboxView';
import { CHAMPION_MODEL_QVCE, CHAMPION_MODEL_QWIN } from './lib/championModel';
import type {
  CourtQuantModel,
  CourtQuantPackage,
  ModelValidationResult,
  UploadStatusResponse,
} from './lib/courtquantTypes';

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('registry');
  const [models, setModels] = useState<CourtQuantModel[]>([CHAMPION_MODEL_QWIN, CHAMPION_MODEL_QVCE]);
  const [validationResults, setValidationResults] = useState<Record<string, ModelValidationResult>>({});
  const [auditStatus, setAuditStatus] = useState<UploadStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [backtestData, setBacktestData] = useState<BacktestApiResponse | null>(null);
  const [loadingBacktest, setLoadingBacktest] = useState(false);
  const [draftModel, setDraftModel] = useState<CourtQuantModel>(CHAMPION_MODEL_QWIN);

  const fetchBacktest = useCallback(async () => {
    setLoadingBacktest(true);
    try {
      const res = await fetch('/api/backtest');
      if (res.ok) {
        const data = (await res.json()) as BacktestApiResponse;
        setBacktestData(data);
      }
    } finally {
      setLoadingBacktest(false);
    }
  }, []);

  const fetchAuditStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/audit/status');
      if (res.ok) {
        const data = (await res.json()) as UploadStatusResponse;
        setAuditStatus(data);
        if (data.hasAuditFile) {
          void fetchBacktest();
        }
      }
    } finally {
      setLoadingStatus(false);
    }
  }, [fetchBacktest]);

  useEffect(() => {
    void fetchAuditStatus();
    void (async () => {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = (await res.json()) as {
          allModels?: CourtQuantModel[];
          basePackage: CourtQuantPackage;
          validation: { modelResults: Record<string, ModelValidationResult> };
        };
        setModels(data.allModels ?? data.basePackage.models ?? []);
        setValidationResults(data.validation?.modelResults ?? {});
      }
    })();
  }, [fetchAuditStatus]);

  function handleExportDraft() {
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
    a.download = `${draftModel.abbreviation.toLowerCase() || 'courtquant-model'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onExportActive={handleExportDraft}
      />

      <div className="mx-auto flex max-w-[1440px] flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 border-b border-slate-200 bg-white p-4 lg:min-h-[calc(100vh-57px)] lg:w-64 lg:border-b-0 lg:border-r">
          <div className="space-y-1">
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
              <span className="truncate">Data Ingestion &amp; Audit</span>
            </button>
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
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-2">
            <div className="font-semibold text-slate-700">Workspace Dataset</div>
            <div className="tabular-nums">
              {auditStatus?.hasAuditFile
                ? `capture-audit.json (${(auditStatus.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`
                : 'Waiting for capture-audit.json'}
            </div>
            {auditStatus?.summary && (
              <div className="tabular-nums">
                {auditStatus.summary.uniqueFixtureCount} fixtures ·{' '}
                {auditStatus.summary.settledFixtureCount} settled
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {activeTab === 'ingestion' && (
            <AuditIngestionView
              status={auditStatus}
              loadingStatus={loadingStatus}
              onRefreshStatus={fetchAuditStatus}
              onUploadComplete={(nextStatus) => {
                setAuditStatus(nextStatus);
                if (nextStatus.hasAuditFile) {
                  void fetchBacktest();
                } else {
                  setBacktestData(null);
                }
              }}
            />
          )}
          {activeTab === 'registry' && (
            <ModelRegistryView
              models={models}
              validationResults={validationResults}
              backtestData={backtestData}
              loadingBacktest={loadingBacktest}
              onCloneToSandbox={(model) => {
                setDraftModel({
                  ...model,
                  fullName: model.abbreviation === 'QVCE' ? model.fullName : `${model.fullName} Copy`,
                  abbreviation:
                    model.abbreviation === 'QWIN'
                      ? 'QWIN2'
                      : model.abbreviation === 'QVCE'
                        ? 'QVCE2'
                        : model.abbreviation.startsWith('M')
                          ? `C${model.abbreviation}`
                          : `${model.abbreviation.slice(0, 6)}2`,
                  builtIn: false,
                });
                setActiveTab('sandbox');
              }}
            />
          )}
          {activeTab === 'sandbox' && (
            <FormulaSandboxView
              draftModel={draftModel}
              onChangeDraft={setDraftModel}
              hasAuditDataset={Boolean(auditStatus?.hasAuditFile)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
