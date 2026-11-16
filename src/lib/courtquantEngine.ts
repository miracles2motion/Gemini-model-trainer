import type {
  CandidateOptionContext,
  CourtQuantFormulas,
  CourtQuantModel,
  CourtQuantPackage,
  FormulaSlot,
  FormulaValidationIssue,
  MarketFormulaSlot,
  ModelProjectionResult,
  ModelValidationResult,
  SiblingProjections,
  TeamStats,
} from './courtquantTypes.ts';

export const RESERVED_ABBREVIATIONS = new Set([
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'M6',
  'M7',
  'M8',
]);

export const TEAM_STAT_FIELDS = [
  'g',
  'srs',
  'pts',
  'opp_pts',
  'pts_g',
  'opp_g',
  'total_g',
  'pace',
  'fga',
  'fta',
  'orb',
  'tov',
  'mp',
  'sos',
  'fg',
  'fg3',
  'fg3a',
  'ft',
  'opp_fg',
  'opp_fga',
  'opp_fg3',
  'opp_fg3a',
  'opp_ft',
  'opp_fta',
  'opp_orb',
  'opp_tov',
] as const;

export const ALLOWED_TEAM_VARIABLES = new Set<string>([
  ...TEAM_STAT_FIELDS.map((f) => `home.${f}`),
  ...TEAM_STAT_FIELDS.map((f) => `away.${f}`),
]);

export const ALLOWED_OPT_VARIABLES = new Set<string>([
  'opt.edge',
  'opt.z',
  'opt.prob',
  'opt.odds',
  'opt.implied_prob',
  'opt.ev',
  'opt.line',
  'opt.is_total',
  'opt.is_home_total',
  'opt.is_away_total',
  'opt.is_handicap',
  'opt.is_win',
]);

export const ALLOWED_PROJ_VARIABLES = new Set<string>([
  'proj.home',
  'proj.away',
  'proj.total',
  'proj.margin',
]);

export const ALLOWED_FUNCTIONS = new Set<string>([
  'abs',
  'sqrt',
  'min',
  'max',
  'pow',
]);

const FUNCTION_ARITY: Record<string, number> = {
  abs: 1,
  sqrt: 1,
  min: 2,
  max: 2,
  pow: 2,
};

const PROJ_FORBIDDEN_BY_SLOT: Record<FormulaSlot, Set<string>> = {
  homeTotal: new Set(['proj.home']),
  awayTotal: new Set(['proj.away']),
  matchTotal: new Set(['proj.total']),
  handicap: new Set(['proj.margin']),
  straightWin: new Set(),
  decision: new Set(),
  pickGate: new Set(),
};

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export function tokenizeFormula(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      throw new Error(`Formula must be a single line (newline at position ${i})`);
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      if (ch === '*' && expr[i + 1] === '*') {
        throw new Error(`Forbidden operator "**" at position ${i}; use pow(x, y)`);
      }
      tokens.push({ type: 'op', value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === '^' || ch === '%' || ch === '?' || ch === ':' || ch === '<' || ch === '>' || ch === '=') {
      throw new Error(`Forbidden syntax "${ch}" at position ${i}`);
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const start = i;
      let dotCount = ch === '.' ? 1 : 0;
      i += 1;
      while (i < expr.length) {
        const c = expr[i];
        if (c >= '0' && c <= '9') {
          i += 1;
        } else if (c === '.') {
          dotCount += 1;
          if (dotCount > 1) {
            throw new Error(`Invalid numeric literal at position ${start}`);
          }
          i += 1;
        } else {
          break;
        }
      }
      const numText = expr.slice(start, i);
      if (numText === '.') {
        throw new Error(`Invalid numeric literal "." at position ${start}`);
      }
      tokens.push({ type: 'number', value: numText, pos: start });
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      const start = i;
      i += 1;
      while (i < expr.length) {
        const c = expr[i];
        if (
          (c >= 'a' && c <= 'z') ||
          (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') ||
          c === '_' ||
          c === '.'
        ) {
          i += 1;
        } else {
          break;
        }
      }
      tokens.push({ type: 'ident', value: expr.slice(start, i), pos: start });
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at position ${i}`);
  }
  return tokens;
}

type AstNode =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '+' | '-'; arg: AstNode }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: AstNode; right: AstNode }
  | { kind: 'call'; fn: string; args: AstNode[] };

export function parseFormulaAst(expr: string): { ast: AstNode; variables: Set<string> } {
  if (!expr || expr.trim().length === 0) {
    throw new Error('Formula string is empty');
  }
  if (expr.length > 2000) {
    throw new Error(`Formula exceeds 2000 character limit (${expr.length} chars)`);
  }
  const tokens = tokenizeFormula(expr);
  let idx = 0;
  const variables = new Set<string>();

  function peek(): Token | undefined {
    return tokens[idx];
  }

  function consume(): Token {
    const t = tokens[idx];
    if (!t) {
      throw new Error('Unexpected end of formula');
    }
    idx += 1;
    return t;
  }

  function parseExpression(): AstNode {
    let node = parseTerm();
    while (peek()?.type === 'op' && (peek()?.value === '+' || peek()?.value === '-')) {
      const op = consume().value as '+' | '-';
      const right = parseTerm();
      node = { kind: 'bin', op, left: node, right };
    }
    return node;
  }

  function parseTerm(): AstNode {
    let node = parseUnary();
    while (peek()?.type === 'op' && (peek()?.value === '*' || peek()?.value === '/')) {
      const op = consume().value as '*' | '/';
      const right = parseUnary();
      node = { kind: 'bin', op, left: node, right };
    }
    return node;
  }

  function parseUnary(): AstNode {
    const t = peek();
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      consume();
      return { kind: 'unary', op: t.value as '+' | '-', arg: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): AstNode {
    const t = peek();
    if (!t) {
      throw new Error('Unexpected end of formula');
    }
    if (t.type === 'number') {
      consume();
      const val = Number(t.value);
      if (!Number.isFinite(val)) {
        throw new Error(`Non-finite number "${t.value}" at position ${t.pos}`);
      }
      if (peek()?.type === 'lparen' || peek()?.type === 'ident') {
        throw new Error(`Implicit multiplication is forbidden near "${t.value}" at position ${t.pos}`);
      }
      return { kind: 'num', value: val };
    }
    if (t.type === 'lparen') {
      consume();
      const inner = parseExpression();
      const close = peek();
      if (!close || close.type !== 'rparen') {
        throw new Error(`Missing closing parenthesis for "(" at position ${t.pos}`);
      }
      consume();
      if (peek()?.type === 'lparen' || peek()?.type === 'ident' || peek()?.type === 'number') {
        throw new Error(`Implicit multiplication after ")" is forbidden near position ${close.pos}`);
      }
      return inner;
    }
    if (t.type === 'ident') {
      consume();
      if (peek()?.type === 'lparen') {
        if (!ALLOWED_FUNCTIONS.has(t.value)) {
          throw new Error(`Forbidden or unknown function "${t.value}()" at position ${t.pos}`);
        }
        consume();
        const args: AstNode[] = [];
        if (peek()?.type !== 'rparen') {
          args.push(parseExpression());
          while (peek()?.type === 'comma') {
            consume();
            args.push(parseExpression());
          }
        }
        const close = peek();
        if (!close || close.type !== 'rparen') {
          throw new Error(`Unclosed function call "${t.value}(" at position ${t.pos}`);
        }
        consume();
        const expectedArity = FUNCTION_ARITY[t.value];
        if (args.length !== expectedArity) {
          throw new Error(
            `Function "${t.value}" requires ${expectedArity} argument(s), got ${args.length}`,
          );
        }
        if (peek()?.type === 'lparen' || peek()?.type === 'ident' || peek()?.type === 'number') {
          throw new Error(`Implicit multiplication after "${t.value}()" is forbidden`);
        }
        return { kind: 'call', fn: t.value, args };
      }
      variables.add(t.value);
      if (peek()?.type === 'lparen') {
        throw new Error(`Implicit multiplication near "${t.value}" at position ${t.pos}`);
      }
      return { kind: 'var', name: t.value };
    }
    throw new Error(`Unexpected token "${t.value}" at position ${t.pos}`);
  }

  const ast = parseExpression();
  if (idx < tokens.length) {
    const extra = tokens[idx];
    throw new Error(`Unexpected token "${extra.value}" at position ${extra.pos}`);
  }
  return { ast, variables };
}

export class MissingDataError extends Error {
  constructor(variableName: string) {
    super(`NO DATA (${variableName} missing)`);
    this.name = 'MissingDataError';
  }
}

export function evalAst(ast: AstNode, env: Record<string, number | null | undefined>): number {
  switch (ast.kind) {
    case 'num':
      return ast.value;
    case 'var': {
      const val = env[ast.name];
      if (val === null || val === undefined || !Number.isFinite(val)) {
        throw new MissingDataError(ast.name);
      }
      return val;
    }
    case 'unary': {
      const v = evalAst(ast.arg, env);
      return ast.op === '-' ? -v : v;
    }
    case 'bin': {
      const l = evalAst(ast.left, env);
      const r = evalAst(ast.right, env);
      switch (ast.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          if (r === 0) {
            throw new Error('Division by zero');
          }
          return l / r;
      }
    }
    case 'call': {
      if (ast.fn === 'abs') {
        return Math.abs(evalAst(ast.args[0], env));
      }
      if (ast.fn === 'sqrt') {
        const v = evalAst(ast.args[0], env);
        if (v < 0) {
          throw new Error('sqrt of negative value');
        }
        return Math.sqrt(v);
      }
      if (ast.fn === 'min') {
        return Math.min(evalAst(ast.args[0], env), evalAst(ast.args[1], env));
      }
      if (ast.fn === 'max') {
        return Math.max(evalAst(ast.args[0], env), evalAst(ast.args[1], env));
      }
      if (ast.fn === 'pow') {
        const base = evalAst(ast.args[0], env);
        const exp = evalAst(ast.args[1], env);
        const res = Math.pow(base, exp);
        if (!Number.isFinite(res)) {
          throw new Error('pow produced non-finite result');
        }
        return res;
      }
      throw new Error(`Unsupported function: ${ast.fn}`);
    }
  }
}

export function validateFormulaSlot(
  slot: FormulaSlot,
  expr: string | null | undefined,
): { issues: FormulaValidationIssue[]; variables: Set<string> } {
  const issues: FormulaValidationIssue[] = [];
  if (expr === null || expr === undefined) {
    return { issues, variables: new Set() };
  }
  try {
    const { variables } = parseFormulaAst(expr);
    for (const variable of variables) {
      if (ALLOWED_TEAM_VARIABLES.has(variable)) {
        continue;
      }
      if (ALLOWED_PROJ_VARIABLES.has(variable)) {
        if (PROJ_FORBIDDEN_BY_SLOT[slot].has(variable)) {
          issues.push({
            slot,
            message: `Circular self-reference "${variable}" is not allowed inside "${slot}"`,
          });
        }
        continue;
      }
      if (variable === 'model.trust' || ALLOWED_OPT_VARIABLES.has(variable)) {
        if (slot !== 'decision' && slot !== 'pickGate') {
          issues.push({
            slot,
            message: `Variable "${variable}" is only allowed inside decision/pickGate, not "${slot}"`,
          });
        }
        continue;
      }
      issues.push({
        slot,
        message: `Unknown variable "${variable}" in "${slot}"`,
      });
    }
    return { issues, variables };
  } catch (err) {
    issues.push({
      slot,
      message: err instanceof Error ? err.message : String(err),
    });
    return { issues, variables: new Set() };
  }
}

function findProjectionCycle(formulas: CourtQuantFormulas): string | null {
  const slotToProjVar: Partial<Record<MarketFormulaSlot, string>> = {
    homeTotal: 'proj.home',
    awayTotal: 'proj.away',
    matchTotal: 'proj.total',
    handicap: 'proj.margin',
  };
  const projVarToSlot: Record<string, MarketFormulaSlot> = {
    'proj.home': 'homeTotal',
    'proj.away': 'awayTotal',
    'proj.total': 'matchTotal',
    'proj.margin': 'handicap',
  };

  const deps = new Map<MarketFormulaSlot, MarketFormulaSlot[]>();
  const slots: MarketFormulaSlot[] = ['homeTotal', 'awayTotal', 'matchTotal', 'handicap', 'straightWin'];
  for (const s of slots) {
    const expr = formulas[s];
    const list: MarketFormulaSlot[] = [];
    if (typeof expr === 'string' && expr.trim().length > 0) {
      try {
        const { variables } = parseFormulaAst(expr);
        for (const v of variables) {
          const targetSlot = projVarToSlot[v];
          if (targetSlot && targetSlot !== s) {
            list.push(targetSlot);
          } else if (v === slotToProjVar[s]) {
            return `${s} references itself via ${v}`;
          }
        }
      } catch {
        // Syntax error is reported separately
      }
    }
    deps.set(s, list);
  }

  const state = new Map<MarketFormulaSlot, 'visiting' | 'done'>();
  function dfs(node: MarketFormulaSlot): string | null {
    const current = state.get(node);
    if (current === 'visiting') {
      return `Circular sibling projection cycle involving ${node}`;
    }
    if (current === 'done') {
      return null;
    }
    state.set(node, 'visiting');
    for (const next of deps.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) {
        return cycle;
      }
    }
    state.set(node, 'done');
    return null;
  }

  for (const s of slots) {
    const cycle = dfs(s);
    if (cycle) {
      return cycle;
    }
  }
  return null;
}

export function validateCourtQuantModel(
  model: CourtQuantModel,
  options: { allowBuiltInReserved?: boolean } = {},
): ModelValidationResult {
  const issues: FormulaValidationIssue[] = [];

  if (!model.fullName || model.fullName.trim().length < 3 || model.fullName.trim().length > 60) {
    issues.push({
      slot: 'model',
      message: 'fullName must be between 3 and 60 characters',
    });
  }

  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(model.abbreviation || '')) {
    issues.push({
      slot: 'model',
      message: 'abbreviation must match ^[A-Z][A-Z0-9]{0,7}$ (1-8 uppercase chars)',
    });
  }

  if (!options.allowBuiltInReserved && !model.builtIn && RESERVED_ABBREVIATIONS.has(model.abbreviation)) {
    issues.push({
      slot: 'model',
      message: `Abbreviation "${model.abbreviation}" is reserved (M1-M8)`,
    });
  }

  const marketSlots: MarketFormulaSlot[] = [
    'matchTotal',
    'homeTotal',
    'awayTotal',
    'handicap',
    'straightWin',
  ];
  const hasMarket = marketSlots.some(
    (s) => typeof model.formulas?.[s] === 'string' && model.formulas[s]!.trim().length > 0,
  );
  if (!hasMarket) {
    issues.push({
      slot: 'model',
      message: 'Model must define at least one market formula (matchTotal, homeTotal, awayTotal, handicap, or straightWin)',
    });
  }

  const allSlots: FormulaSlot[] = [
    'matchTotal',
    'homeTotal',
    'awayTotal',
    'handicap',
    'straightWin',
    'decision',
    'pickGate',
  ];
  for (const slot of allSlots) {
    const { issues: slotIssues } = validateFormulaSlot(slot, model.formulas?.[slot]);
    issues.push(...slotIssues);
  }

  const cycle = findProjectionCycle(model.formulas ?? {});
  if (cycle) {
    issues.push({ slot: 'model', message: cycle });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function validateCourtQuantPackage(pkg: CourtQuantPackage): {
  valid: boolean;
  errors: string[];
  modelResults: Record<string, ModelValidationResult>;
} {
  const errors: string[] = [];
  const modelResults: Record<string, ModelValidationResult> = {};

  if (pkg.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${String(pkg.schemaVersion)})`);
  }
  if (pkg.app !== 'CourtQuant') {
    errors.push(`app must be "CourtQuant" (got ${String(pkg.app)})`);
  }
  if (!Array.isArray(pkg.models) || pkg.models.length === 0) {
    errors.push('models array must contain at least 1 model');
  } else if (pkg.models.length > 50) {
    errors.push(`models array exceeds maximum of 50 models (${pkg.models.length})`);
  }

  const seenNames = new Set<string>();
  const seenAbbr = new Set<string>();

  for (const model of pkg.models ?? []) {
    if (seenNames.has(model.fullName)) {
      errors.push(`Duplicate fullName "${model.fullName}"`);
    }
    seenNames.add(model.fullName);

    if (seenAbbr.has(model.abbreviation)) {
      errors.push(`Duplicate abbreviation "${model.abbreviation}"`);
    }
    seenAbbr.add(model.abbreviation);

    const res = validateCourtQuantModel(model, { allowBuiltInReserved: Boolean(model.builtIn) });
    modelResults[model.abbreviation] = res;
    if (!res.valid) {
      for (const issue of res.issues) {
        errors.push(`[${model.abbreviation}:${issue.slot}] ${issue.message}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    modelResults,
  };
}

export function buildTeamEnv(
  home: TeamStats,
  away: TeamStats,
  proj: SiblingProjections = {},
  opt?: Partial<CandidateOptionContext>,
  modelTrust = 1.0,
): Record<string, number | null | undefined> {
  const env: Record<string, number | null | undefined> = {};
  for (const field of TEAM_STAT_FIELDS) {
    env[`home.${field}`] = home[field];
    env[`away.${field}`] = away[field];
  }
  env['proj.home'] = proj.home ?? null;
  env['proj.away'] = proj.away ?? null;
  env['proj.total'] = proj.total ?? null;
  env['proj.margin'] = proj.margin ?? null;
  env['model.trust'] = modelTrust;
  if (opt) {
    for (const key of ALLOWED_OPT_VARIABLES) {
      const shortKey = key.slice(4) as keyof CandidateOptionContext;
      env[key] = opt[shortKey] ?? null;
    }
  }
  return env;
}

export function evaluateModelProjections(
  formulas: CourtQuantFormulas,
  home: TeamStats,
  away: TeamStats,
): ModelProjectionResult {
  const slots: MarketFormulaSlot[] = [
    'homeTotal',
    'awayTotal',
    'matchTotal',
    'handicap',
    'straightWin',
  ];
  const slotToProj: Partial<Record<MarketFormulaSlot, keyof SiblingProjections>> = {
    homeTotal: 'home',
    awayTotal: 'away',
    matchTotal: 'total',
    handicap: 'margin',
  };
  const projToSlot: Record<string, MarketFormulaSlot> = {
    'proj.home': 'homeTotal',
    'proj.away': 'awayTotal',
    'proj.total': 'matchTotal',
    'proj.margin': 'handicap',
  };

  const parsed = new Map<MarketFormulaSlot, { ast: AstNode; deps: MarketFormulaSlot[] }>();
  const errors: Partial<Record<FormulaSlot, string>> = {};
  const noDataSlots: MarketFormulaSlot[] = [];

  for (const slot of slots) {
    const expr = formulas[slot];
    if (!expr || expr.trim().length === 0) {
      continue;
    }
    try {
      const { ast, variables } = parseFormulaAst(expr);
      const deps: MarketFormulaSlot[] = [];
      for (const v of variables) {
        if (projToSlot[v]) {
          deps.push(projToSlot[v]);
        }
      }
      parsed.set(slot, { ast, deps });
    } catch (err) {
      errors[slot] = err instanceof Error ? err.message : String(err);
    }
  }

  const values: Record<MarketFormulaSlot, number | null> = {
    matchTotal: null,
    homeTotal: null,
    awayTotal: null,
    handicap: null,
    straightWin: null,
  };
  const proj: SiblingProjections = {};
  const resolved = new Set<MarketFormulaSlot>();
  const visiting = new Set<MarketFormulaSlot>();

  function resolveSlot(slot: MarketFormulaSlot): number | null {
    if (resolved.has(slot)) {
      return values[slot];
    }
    if (visiting.has(slot)) {
      errors[slot] = `Circular dependency detected at ${slot}`;
      return null;
    }
    const entry = parsed.get(slot);
    if (!entry) {
      resolved.add(slot);
      return null;
    }
    visiting.add(slot);
    for (const dep of entry.deps) {
      resolveSlot(dep);
    }
    visiting.delete(slot);

    try {
      const env = buildTeamEnv(home, away, proj);
      const val = evalAst(entry.ast, env);
      values[slot] = val;
      const projKey = slotToProj[slot];
      if (projKey) {
        proj[projKey] = val;
      }
    } catch (err) {
      if (err instanceof MissingDataError) {
        noDataSlots.push(slot);
      } else {
        errors[slot] = err instanceof Error ? err.message : String(err);
      }
      values[slot] = null;
    }
    resolved.add(slot);
    return values[slot];
  }

  for (const slot of slots) {
    resolveSlot(slot);
  }

  return {
    matchTotal: values.matchTotal,
    homeTotal: values.homeTotal,
    awayTotal: values.awayTotal,
    handicap: values.handicap,
    straightWin: values.straightWin,
    noDataSlots,
    errors,
  };
}

export interface CompiledFormula {
  ast: AstNode;
  variables: Set<string>;
}

export function compileFormula(expr: string | null | undefined): CompiledFormula | null {
  if (!expr || expr.trim().length === 0) {
    return null;
  }
  return parseFormulaAst(expr);
}

export function evaluateDecisionOrGate(
  expr: string | null | undefined,
  home: TeamStats,
  away: TeamStats,
  proj: SiblingProjections,
  opt: CandidateOptionContext,
  modelTrust = 1.0,
  precompiled?: CompiledFormula | null,
): { value: number | null; error?: string } {
  if (!expr || expr.trim().length === 0) {
    return { value: null };
  }
  try {
    const compiled = precompiled ?? parseFormulaAst(expr);
    const env = buildTeamEnv(home, away, proj, opt, modelTrust);
    return { value: evalAst(compiled.ast, env) };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

