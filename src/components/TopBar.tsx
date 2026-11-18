import React from 'react';

export type WorkspaceTab = 'registry' | 'ingestion' | 'sandbox' | 'settings';

interface TopBarProps {
  activeTab: WorkspaceTab;
  modelCount: number;
  onSelectTab: (tab: WorkspaceTab) => void;
  onExportLibrary: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  modelCount,
  onSelectTab,
  onExportLibrary,
}) => {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6">
      <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
        CourtQuant Model Lab
      </span>

      <nav className="hidden md:flex items-center gap-8" aria-label="Primary navigation">
        <button
          type="button"
          onClick={() => onSelectTab('registry')}
          className={`text-sm font-medium whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
            activeTab === 'registry'
              ? 'border-teal-700 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Models
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('ingestion')}
          className={`text-sm font-medium whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
            activeTab === 'ingestion'
              ? 'border-teal-700 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Ingestion
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('sandbox')}
          className={`text-sm font-medium whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
            activeTab === 'sandbox'
              ? 'border-teal-700 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Sandbox
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('settings')}
          className={`text-sm font-medium whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
            activeTab === 'settings'
              ? 'border-teal-700 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Settings
        </button>
      </nav>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          disabled={modelCount === 0}
          onClick={onExportLibrary}
          className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          Export Library ({modelCount})
        </button>
      </div>
    </header>
  );
};
