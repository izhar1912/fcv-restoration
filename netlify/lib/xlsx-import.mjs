// Reads the FCV "Member Portal Admin Tracker" workbook and turns it into a project.
// Works from the sheet headers (not fixed cell positions) and cross-checks the workbook's own totals.
import readXlsxFile from 'read-excel-file/node';
import { HttpError } from './http.mjs';
import { createProject } from './projects.mjs';
import { createEntity } from './entities.mjs';
import { writeAudit } from './audit.mjs';

const clean = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const norm = (v) => clean(v).toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cents = (v) => (num(v) === null ? null : Math.round(v * 100));
const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());
const ymd = (v) => (isDate(v) ? v.toISOString().slice(0, 10) : '');

// Lines that are only true at the moment the workbook was saved, or that talk about the workbook/website itself.
// They would become false (or confusing) inside a live portal, so they are skipped and the portal computes the facts instead.
const VOLATILE = [
  [/\$|\d\s?%/, 'contains a fixed figure (the portal shows live numbers instead)'],
  [/portal|website|web site|log-?in|workbook|excel|shared link|cloud folder|view-only access|synchron/i, 'is about the workbook or website, not the project'],
  [/have been entered|are entered|no actual|not yet entered|has not been created/i, 'a snapshot that stops being true once records are added (the portal states this live)'],
  [/count only when|only approved/i, 'a general rule (the portal shows it on every project)']
];
const volatileReason = (line) => { for (const [re, why] of VOLATILE) if (re.test(line)) return why; return null; };

const sheetRows = (sheets, name) => { const s = sheets.find((x) => norm(x.sheet) === norm(name)); return s ? s.data : null; };
const findHeader = (rows, firstCell) => rows.findIndex((r) => norm(r[0]) === norm(firstCell));
const colIndex = (headerRow, label) => headerRow.findIndex((c) => norm(c) === norm(label));
const labelValue = (rows, label) => { const r = rows.find((x) => norm(x[0]) === norm(label)); return r ? r[1] : null; };

export async function parseWorkbook(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new HttpError(400, 'import_failed', 'That does not look like an .xlsx workbook.');
  let sheets;
  try { sheets = await readXlsxFile(buffer); } catch { throw new HttpError(400, 'import_failed', 'That workbook could not be read. Save it as .xlsx and try again.'); }
  const report = { skippedNotes: [], warnings: [], checks: [], found: [] };

  const summary = sheetRows(sheets, 'Lender Summary');
  const phase1 = sheetRows(sheets, 'Phase 1 Budget');
  if (!summary || !phase1) throw new HttpError(400, 'import_failed', 'This does not look like the FCV tracker workbook (the "Lender Summary" and "Phase 1 Budget" sheets are required).');
  const fieldMap = sheetRows(sheets, 'Portal Field Map') || [];
  const contract = sheetRows(sheets, 'Contract Overview') || [];

  // ---- project header ----
  const project = { contractor: 'FCV Restoration & Construction', notes: [] };
  project.code = clean(labelValue(fieldMap, 'Project code'));
  project.clientName = clean(labelValue(fieldMap, 'Client'));
  project.address = clean(labelValue(fieldMap, 'Project address'));
  const c = clean(labelValue(fieldMap, 'Contractor')); if (c) project.contractor = c;
  let base = num(labelValue(fieldMap, 'Base project estimate'));
  if (base === null) base = num(labelValue(summary, 'Total base renovation estimate'));
  project.baseEstimateCents = cents(base);
  const sub = clean(summary[2] && summary[2][0]).split('•').map(clean).filter(Boolean);   // address • phase • approval status
  if (!project.address && sub[0]) project.address = sub[0];
  project.phaseLabel = sub[1] || '';
  project.lenderStatus = sub[2] || 'Preliminary / not lender-approved';
  if (!project.clientName) { const m = /prepared for\s*•\s*(.+)/i.exec(clean(summary[1] && summary[1][0])); if (m) project.clientName = m[1]; }
  const lenderLines = summary.map((r) => clean(r[0])).concat(summary.map((r) => clean(r[3])));
  const projLine = lenderLines.find((l) => /project:\s*/i.test(l));
  const pm = projLine && /project:\s*(.+?)\.?$/i.exec(projLine);
  project.title = pm ? pm[1].charAt(0).toUpperCase() + pm[1].slice(1) : (project.phaseLabel || 'Renovation project');
  const srcLine = lenderLines.find((l) => /provided by/i.test(l));
  const sm = srcLine && /\((provided by [^)]+)\)/i.exec(srcLine);
  project.estimateSource = sm ? sm[1].charAt(0).toUpperCase() + sm[1].slice(1) : '';
  if (!project.code) report.warnings.push('No project code found. Enter one before importing.');
  if (!project.clientName) report.warnings.push('No client name found. Enter one before importing.');

  // ---- lasting notes (keep) vs time-sensitive lines (skip) ----
  const nh = summary.findIndex((r) => /project status/i.test(clean(r[3])));
  const noteLines = nh >= 0 ? summary.slice(nh + 1).map((r) => clean(r[3])).filter(Boolean) : [];
  for (const line of noteLines) {
    const why = volatileReason(line);
    if (why) report.skippedNotes.push({ line, reason: why }); else project.notes.push(line);
  }

  // ---- Phase 1 budget ----
  const budgetLines = [];
  const bh = findHeader(phase1, 'Code');
  if (bh >= 0) {
    const h = phase1[bh];
    const ix = { cat: colIndex(h, 'Material / Work Category'), qty: colIndex(h, 'Quantity'), unit: colIndex(h, 'Unit'), price: colIndex(h, 'Unit Price / Allowance'), waste: colIndex(h, 'Waste %'), ext: colIndex(h, 'Extended Amount'), basis: colIndex(h, 'Estimation Basis') };
    for (let i = bh + 1; i < phase1.length; i++) {
      const r = phase1[i];
      if (/^total/i.test(clean(r[0]))) break;
      if (!clean(r[0]) && !clean(r[ix.cat])) { if (budgetLines.length) break; else continue; }
      const q = num(r[ix.qty]); const p = num(r[ix.price]); const w = num(r[ix.waste]) || 0;
      if (q === null || p === null) { report.warnings.push(`Phase 1 Budget row ${i + 1}: quantity or price is missing, so it was skipped.`); continue; }
      budgetLines.push({ code: clean(r[0]), category: clean(r[ix.cat]), quantity: q.toFixed(3), unit: clean(r[ix.unit]), unitPriceCents: Math.round(p * 100), wastePercent: (w * 100).toFixed(2), basis: clean(r[ix.basis]) });
    }
    const totalRow = phase1.slice(bh + 1).find((r) => /^total/i.test(clean(r[0])));
    const sheetTotal = totalRow ? num(totalRow[ix.ext]) : null;
    const computed = budgetLines.reduce((t, l) => t + Math.round(Number(l.quantity) * 1000 * l.unitPriceCents * (10000 + Math.round(Number(l.wastePercent) * 100)) / 1e7), 0);
    if (sheetTotal !== null) report.checks.push({ label: 'Phase 1 materials total', workbook: Math.round(sheetTotal * 100), computed, ok: Math.round(sheetTotal * 100) === computed });
    report.phase1TotalCents = computed;
  } else report.warnings.push('No Phase 1 budget table was found.');

  // ---- draws, supplements, expenses (only rows that really exist) ----
  const table = (sheetName, idHeader) => {
    const rows = sheetRows(sheets, sheetName); if (!rows) return [];
    const h = findHeader(rows, idHeader); if (h < 0) return [];
    const head = rows[h];
    return rows.slice(h + 1).filter((r) => clean(r[0])).map((r) => ({ r, ix: (label) => colIndex(head, label) }));
  };
  const draws = table('Draw Requests', 'Draw ID').map(({ r, ix }) => ({
    drawRef: clean(r[0]), requestedOn: ymd(r[ix('Request Date')]) || null, purpose: clean(r[ix('Purpose / Phase')]), amountRequestedCents: cents(r[ix('Amount Requested')]) ?? 0,
    amountApprovedCents: cents(r[ix('Amount Approved')]), amountDisbursedCents: cents(r[ix('Amount Disbursed')]), status: clean(r[ix('Status')]) || 'Proposed - not submitted', notes: clean(r[ix('Notes / Lender Reference')])
  }));
  const supplements = table('Supplements', 'Supplement ID').map(({ r, ix }) => ({
    supplementRef: clean(r[0]), requestedOn: ymd(r[ix('Date')]) || null, scope: clean(r[ix('Scope / Reason')]), vendorTrade: clean(r[ix('Vendor / Trade')]), supportRef: clean(r[ix('Supporting URL')]),
    amountCents: cents(r[ix('Amount Requested')]) ?? 0, status: clean(r[ix('Status')]) || 'Draft', notes: clean(r[ix('Notes')])
  }));
  const expenses = table('Expense Log', 'Expense ID').map(({ r, ix }) => ({
    expenseRef: clean(r[0]), purchasedOn: ymd(r[ix('Purchase Date')]), vendor: clean(r[ix('Vendor / Supplier')]), budgetCategory: clean(r[ix('Budget Category')]),
    description: clean(r[ix('What Was Purchased')]), receiptRef: clean(r[ix('Receipt URL / Reference')]), amountCents: cents(r[ix('Amount Paid')]) ?? 0, notes: clean(r[ix('Notes / Verification')])
  }));
  for (const s of supplements) if (s.status === 'Approved') report.warnings.push(`Supplement ${s.supplementRef} is marked Approved in the workbook. Add the proof of approval after importing, then approve it in the portal.`);

  // ---- remaining amount breakdown ----
  const remaining = [];
  const rh = findHeader(contract, 'CATEGORY / TRADE');
  if (rh >= 0) for (let i = rh + 1; i < contract.length; i++) {
    const r = contract[i]; if (/^total/i.test(clean(r[0]))) break;
    if (clean(r[0]) && num(r[1]) !== null) remaining.push({ category: clean(r[0]), amountCents: cents(r[1]), note: /^enter after/i.test(clean(r[2])) ? '' : clean(r[2]) });
  }

  // ---- cross-checks against the workbook's own numbers ----
  const baseSheet = num(labelValue(summary, 'Total base renovation estimate'));
  if (baseSheet !== null && project.baseEstimateCents !== null) report.checks.push({ label: 'Total base estimate', workbook: Math.round(baseSheet * 100), computed: project.baseEstimateCents, ok: Math.round(baseSheet * 100) === project.baseEstimateCents });
  const remSheet = num(labelValue(summary, 'Remaining base budget (not yet itemized)'));
  if (remSheet !== null && project.baseEstimateCents !== null && report.phase1TotalCents !== undefined) {
    const computed = project.baseEstimateCents - report.phase1TotalCents;
    report.checks.push({ label: 'Remaining base budget', workbook: Math.round(remSheet * 100), computed, ok: Math.round(remSheet * 100) === computed });
  }
  report.found = [`${budgetLines.length} Phase 1 budget line(s)`, `${draws.length} draw request(s)`, `${expenses.length} expense(s)`, `${supplements.length} supplement(s)`, `${remaining.length} remaining-amount item(s)`];
  if (!expenses.length) report.found.push('No expenses were entered (none will be invented)');
  if (!supplements.length) report.found.push('No supplements were entered (none will be invented)');
  return { project, budgetLines, draws, supplements, expenses, remaining, report };
}

export async function commitImport(db, actor, parsed, overrides = {}) {
  const p = { ...parsed.project };
  for (const k of ['code', 'title', 'clientName', 'address', 'phaseLabel', 'lenderStatus', 'estimateSource', 'stage', 'trackerVisible']) {
    if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== '') p[k] = overrides[k];
  }
  if (p.stage === undefined) p.stage = 'quote_sent';
  if (p.trackerVisible === undefined) p.trackerVisible = true;
  return db.tx(async (q) => {
    const project = await createProject(q, actor, p);
    for (const l of parsed.budgetLines) await createEntity(q, actor, project, 'budget-lines', l);
    for (const x of parsed.remaining) await createEntity(q, actor, project, 'remaining-items', x);
    for (const d of parsed.draws) await createEntity(q, actor, project, 'draws', d);
    for (const s of parsed.supplements) await createEntity(q, actor, project, 'supplements', s);
    for (const e of parsed.expenses) await createEntity(q, actor, project, 'expenses', e);
    await writeAudit(q, actor, { action: 'project.import', entityType: 'project', entityId: project.id, projectId: project.id,
      summary: `Imported ${project.code} from the tracker workbook (${parsed.budgetLines.length} budget lines, ${parsed.draws.length} draws, ${parsed.expenses.length} expenses, ${parsed.supplements.length} supplements)`,
      after: { found: parsed.report.found } });
    return project;
  });
}
