// Number formatting for report data. Show real, full numbers (no abbreviation
// like "10k"). US convention: COMMA thousands separator, PERIOD decimal point
// (e.g. 10000 -> "10,000"; decimals like ER are shown with a period, "0.5%").
export const groupInt = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
