// Zero disables the threshold; unknown views remain unknown, never zero.
export function parseMinimumViews(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function selectRecords(records, { from, to, series = 'all', minimumViews = 0 }) {
  if (!Number.isSafeInteger(minimumViews) || minimumViews < 0) {
    throw new RangeError('O mínimo de views deve ser um inteiro maior ou igual a zero.');
  }
  return records.filter(record =>
    record.date >= from && record.date <= to &&
    (series === 'all' || record.series === series) &&
    (minimumViews === 0 ||
      (typeof record.views === 'number' && Number.isFinite(record.views) && record.views >= minimumViews))
  );
}
