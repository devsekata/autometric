// Report fonts — Microsoft-bundled so the exported PPTX renders identically in
// PowerPoint (no embedding/fallback). Names are used as-is for pptx `fontFace`;
// the CSS stack drives the on-screen preview.

export const REPORT_FONTS = ['Calibri', 'Arial', 'Georgia'] as const
export type ReportFont = (typeof REPORT_FONTS)[number]

export const FONT_META: Record<ReportFont, { kind: string }> = {
  Calibri: { kind: 'Sans-serif' },
  Arial: { kind: 'Sans-serif' },
  Georgia: { kind: 'Serif' },
}

const FONT_STACK: Record<string, string> = {
  Calibri: "Calibri, 'Segoe UI', sans-serif",
  Arial: "Arial, Helvetica, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
}

/** CSS font-family stack for preview (falls back to Calibri's stack). */
export const fontStack = (f: string) => FONT_STACK[f] ?? FONT_STACK.Calibri
