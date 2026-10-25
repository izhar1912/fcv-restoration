// Totals, exactly as the lender workbook computes them (all in whole cents).
const n = (v) => (v === null || v === undefined ? 0 : Number(v));
const sum = (arr, pick) => arr.reduce((t, x) => t + n(pick(x)), 0);

export function computeSummary({ project, lines, expenses, supplements, draws, remaining }) {
  const base = project.baseEstimateCents == null ? null : n(project.baseEstimateCents);
  const phase1 = sum(lines, (l) => l.extendedCents);                                  // Phase 1 Budget total
  const approvedSupplements = sum(supplements.filter((s) => s.status === 'Approved'), (s) => s.amountCents); // only Approved counts
  const expensesTotal = sum(expenses, (e) => e.amountCents);
  const itemized = sum(remaining, (r) => r.amountCents);
  const remainingBase = base == null ? null : base - phase1;
  const revised = base == null ? null : base + approvedSupplements;
  return {
    baseEstimateCents: base,
    phase1TotalCents: phase1,
    remainingBaseCents: remainingBase,
    initialDrawShare: base ? phase1 / base : null,
    approvedSupplementsCents: approvedSupplements,
    revisedBudgetCents: revised,
    expensesCents: expensesTotal,
    budgetLessExpensesCents: revised == null ? null : revised - expensesTotal,
    itemizedRemainingCents: itemized,
    balanceToItemizeCents: remainingBase == null ? null : remainingBase - itemized,
    draws: {
      requestedCents: sum(draws, (d) => d.amountRequestedCents),
      approvedCents: sum(draws, (d) => d.amountApprovedCents),
      disbursedCents: sum(draws, (d) => d.amountDisbursedCents)
    },
    counts: { budgetLines: lines.length, expenses: expenses.length, supplements: supplements.length, approvedSupplements: supplements.filter((s) => s.status === 'Approved').length, draws: draws.length }
  };
}
