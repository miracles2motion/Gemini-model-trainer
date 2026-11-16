import React from 'react';

export type WorkspaceTab = 'ingestion' | 'registry' | 'sandbox';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onExportActive: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onExportActive,
}) => {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6">
      <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
        CourtQuant Model Lab
      </span>

      <nav className="hidden md:flex items-center gap-6" aria-label="Primary navigation">
        <button
          type="button"
          onClick={() => onSelectTab('ingestion')}
          className={`text-sm font-medium whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
            activeTab === 'ingestion'
              ? 'border-teal-700 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Ingestion &amp; Audit
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('registry')}
          className={`text-sm font-medium whitespace-nowrap shrink-0 border-b-2 py-1 transition-colors ${
            activeTab === 'registry'
              ? 'border-teal-700 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Model Registry
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
          Formula Sandbox
        </button>
      </nav>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onExportActive}
          className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          Export Package
        </button>
      </div>
    </header>
  );
};
