import fs from 'node:fs';
import path from 'node:path';
import { inspectAuditPayload } from '../src/lib/auditParser.ts';

const auditPath = path.resolve(process.cwd(), 'data/capture-audit.json');
const summaryOutPath = path.resolve(process.cwd(), 'data/audit-summary.json');

if (!fs.existsSync(auditPath)) {
  console.error('No data/capture-audit.json found on disk yet. Upload it via the web UI first.');
  process.exit(1);
}

const stat = fs.statSync(auditPath);
const raw = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const summary = inspectAuditPayload(raw, 'capture-audit.json', stat.size);

fs.mkdirSync(path.dirname(summaryOutPath), { recursive: true });
fs.writeFileSync(summaryOutPath, JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
