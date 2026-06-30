// Number formatting for report data. Show real, full numbers (no abbreviation
// like "10k") with dot thousands separators, e.g. 10000 -> "10.000".
export const groupInt = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
