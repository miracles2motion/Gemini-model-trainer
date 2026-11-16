export type FormulaSlot =
  | 'matchTotal'
  | 'homeTotal'
  | 'awayTotal'
  | 'handicap'
  | 'straightWin'
  | 'decision'
  | 'pickGate';

export type MarketFormulaSlot =
  | 'matchTotal'
  | 'homeTotal'
  | 'awayTotal'
  | 'handicap'
  | 'straightWin';

export interface CourtQuantFormulas {
  matchTotal?: string | null;
  homeTotal?: string | null;
  awayTotal?: string | null;
  handicap?: string | null;
  straightWin?: string | null;
  decision?: string | null;
  pickGate?: string | null;
}

export interface CourtQuantModel {
  fullName: string;
  abbreviation: string;
  description: string;
  formulas: CourtQuantFormulas;
  builtIn?: boolean;
  attribution?: string;
}

export interface CourtQuantPackage {
  schemaVersion: number;
  app: string;
  exportedAtEpochMs?: number;
  models: CourtQuantModel[];
}

export interface TeamStats {
  g: number;
  srs: number | null;
  sos: number | null;
  pts: number;
  opp_pts: number;
  pts_g: number;
  opp_g: number;
  total_g: number;
  pace: number;
  fga: number;
  fta: number;
  orb: number;
  tov: number;
  mp: number;
  fg: number;
  fg3: number;
  fg3a: number;
  ft: number;
  opp_fg: number;
  opp_fga: number;
  opp_fg3: number;
  opp_fg3a: number;
  opp_ft: number;
  opp_fta: number;
  opp_orb: number;
  opp_tov: number;
}

export interface CandidateOptionContext {
  edge: number;
  z: number;
  prob: number;
  odds: number;
  implied_prob: number;
  ev: number;
  line: number;
  is_total: number;
  is_home_total: number;
  is_away_total: number;
  is_handicap: number;
  is_win: number;
}

export interface SiblingProjections {
  home?: number | null;
  away?: number | null;
  total?: number | null;
  margin?: number | null;
}

export interface FormulaValidationIssue {
  slot: FormulaSlot | 'model';
  message: string;
}

export interface ModelValidationResult {
  valid: boolean;
  issues: FormulaValidationIssue[];
}

export interface ModelProjectionResult {
  matchTotal: number | null;
  homeTotal: number | null;
  awayTotal: number | null;
  handicap: number | null;
  straightWin: number | null;
  noDataSlots: MarketFormulaSlot[];
  errors: Partial<Record<FormulaSlot, string>>;
}

export interface SchemaFieldSummary {
  path: string;
  types: string[];
  presentCount: number;
  sampleKeys?: string[];
}

export interface AuditInspectionSummary {
  inspectedAtIso: string;
  fileName: string;
  fileSizeBytes: number;
  topLevelKeys: string[];
  schemaVersion: number | string | null;
  headerMetadata: Record<string, string | number | boolean | null>;
  definitionTableKeys: string[];
  definitionCount: number;
  recordCollectionKey: string | null;
  totalRecords: number;
  uniqueFixtureCount: number;
  settledFixtureCount: number;
  missingSrsCount: number;
  missingSosCount: number;
  receiptCount: number;
  detectedCourtQuantVariables: string[];
  missingCourtQuantVariables: string[];
  sampleRecordSchema: SchemaFieldSummary[];
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
  warnings: string[];
}

export interface UploadStatusResponse {
  hasAuditFile: boolean;
  fileSizeBytes: number;
  updatedAtIso: string | null;
  summary: AuditInspectionSummary | null;
}
