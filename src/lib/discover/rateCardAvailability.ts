/**
 * Whether the KOL product has an official rate-card source.
 *
 * It does not, today:
 *   * `l1_silver.unified_rate_card` (the table the directory's `rateFrom` and
 *     `maxRate` filter read) holds 0 rows, and so does every layer under it
 *     (`l0_extra.*_rate_card`, `l0_harmonization.*_rate_card`).
 *   * Roster prices in `l0_raw.kol_roster_import` are not a rate card — the
 *     owner decision in scrapper migration 048 disabled that mapping and
 *     migration 050 removed the rows it had produced.
 *   * `/discover/rates` (the org's own price overrides) answers 503: it lived on
 *     warehouse tables the KOL-only product does not use.
 *
 * So every rate-card control is shown as unavailable rather than as a live
 * control over an empty table, and no price is ever shown as 0. Flip this only
 * when an approved rate-card feed fills `unified_rate_card`.
 *
 * Client-safe on purpose: no imports, so components can read it.
 */
export const RATE_CARD_AVAILABLE = false

export const RATE_CARD_UNAVAILABLE_REASON =
  'Rate card belum punya sumber resmi di database KOL, jadi harga belum bisa ditampilkan, difilter, atau diatur.'
