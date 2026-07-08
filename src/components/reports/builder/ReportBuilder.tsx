'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DashBrand } from '@/components/dashboard/data'
import { CoverColors, CoverMode, extractPalette, normalizeHex } from '@/lib/reports/cover/colors'
import { COVER_TEMPLATES, getTemplate } from '@/lib/reports/cover/templates'
import { exportCoverPptx } from '@/lib/reports/export/exportCover'
import { exportReportPptx } from '@/lib/reports/export/exportReport'
import { downloadBlob, saveExportToLibrary, saveTemplateToLibrary } from '@/lib/reports/export/clientSave'
import { ReportTableMetrics } from '@/lib/reports/data/tableTypes'
import { ReportChartMetrics } from '@/lib/reports/data/chartTypes'
import { ReportKpiMetrics } from '@/lib/reports/data/kpiMetrics'
import { ReportPostMetrics } from '@/lib/reports/data/posts'
import { ReportMetricsContext, ReportChartContext, ReportKpiContext, ReportPostContext, ReportAIContext } from '@/lib/reports/data/metricsContext'
import {
  ContentSlide, SlideType, SlideChrome, ConfigBlock, ChartConfig, TableConfig, makeSlide,
  type ReportTemplateConfig, type ReportTemplateRecord,
} from '@/lib/reports/data/slideModel'
import CoverPreview from '../cover/CoverPreview'
import SlideTypePicker from '../modals/SlideTypePicker'
import ChartSelectionModal from '../modals/ChartSelectionModal'
import TableSelectionModal from '../modals/TableSelectionModal'
import MetricPickerModal from '../modals/MetricPickerModal'
import SaveTemplateModal from '../modals/SaveTemplateModal'
import { useToast, ToastHost } from '../Toast'
import Stepper, { Step } from './Stepper'
import SetupStep from './SetupStep'
import SlidesReview from './SlidesReview'
import SlideEditor from './SlideEditor'
import { PJ, Panel, Field } from './ui'
import { MONTHS, NOW } from './constants'

let slideSeq = 0

// Seed slides from a saved template: fresh ids + cleared insights (insights are
// data-specific to the original report, so the user re-writes them per apply).
function seedTemplateSlides(slides: ContentSlide[]): ContentSlide[] {
  return slides.map((s, i) => ({ ...s, id: `tpl-${i}-${s.type}`, insights: '' }))
}

// Fetch a remote image (the brand logo) and convert it to a data URL, so it behaves
// EXACTLY like a manually uploaded logo — same preview + PPTX export path, no
// cross-origin canvas taint. Returns null if it can't be fetched/decoded.
async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>(resolve => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  } catch { return null }
}

export default function ReportBuilder({
  orgName,
  orgId,
  brands,
  templates,
  onExit,
  initialTemplateId,
}: {
  orgName: string
  orgId: string
  brands: DashBrand[]
  templates: ReportTemplateRecord[]
  onExit?: () => void
  initialTemplateId?: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('setup')

  // Setup state — brands come from the DB (real, org-scoped).
  const [brandId, setBrandId] = useState(brands[0]?.id ?? '')
  const [month, setMonth] = useState(MONTHS[NOW.getMonth()])
  const [year, setYear] = useState(NOW.getFullYear())
  const [title, setTitle] = useState('Social Media Performance Report')
  const [subtitle, setSubtitle] = useState('Monthly Analytics & Insights')
  const [font, setFont] = useState('Calibri')

  // Cover state. Branding (colors/logo) stays brand-driven.
  const [templateId, setTemplateId] = useState(initialTemplateId ?? COVER_TEMPLATES[0].id)
  const [mode, setMode] = useState<CoverMode>('light')
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  // true once the user uploads their own logo → stop auto-filling from the brand.
  const [logoIsManual, setLogoIsManual] = useState(false)
  const [colors, setColors] = useState<CoverColors>({
    primary: brands[0]?.color ?? '#1e4f49',
    secondary: '#3d7e96',
    accent: '#e0a458',
  })
  const [isExporting, setIsExporting] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const coverCaptureRef = useRef<HTMLDivElement>(null)

  // Rasterize the off-screen full-size cover to a PNG data URI for the history preview.
  async function captureCover(): Promise<string | null> {
    if (!coverCaptureRef.current) return null
    try {
      const { toPng } = await import('html-to-image')
      return await toPng(coverCaptureRef.current, { cacheBust: true, pixelRatio: 1.6 })
    } catch (e) {
      console.error('[export] cover capture failed:', e)
      return null
    }
  }

  // Slides state (Stage 2 — per-slide editing). Starts empty.
  const [slides, setSlides] = useState<ContentSlide[]>([])
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [configBlock, setConfigBlock] = useState<ConfigBlock | null>(null)
  const activeIndex = slides.findIndex(s => s.id === activeSlideId)
  const activeSlide = slides[activeIndex]

  const brand = useMemo(() => brands.find(b => b.id === brandId) ?? null, [brands, brandId])
  const brandName = brand?.name ?? ''
  const period = `${month} ${year}`

  // Real Content/Channel Level table values for this brand + period (current vs
  // previous month). Provided via context so TableBlock renders live DB numbers.
  const [tableMetrics, setTableMetrics] = useState<ReportTableMetrics | null>(null)
  // Real line-chart time series for this brand + period (report month + 2 prior),
  // provided via context so ChartBlock renders live DB numbers.
  const [chartMetrics, setChartMetrics] = useState<ReportChartMetrics | null>(null)
  // Real KPI scorecard values for this brand + period (current vs previous month).
  const [kpiMetrics, setKpiMetrics] = useState<ReportKpiMetrics | null>(null)
  // Live post pool (per channel) for this brand + report month, provided via context
  // so the Visual Analysis slide ranks real posts by Format / Pillar / metric.
  const [postMetrics, setPostMetrics] = useState<ReportPostMetrics | null>(null)
  useEffect(() => {
    if (!brandId) { setTableMetrics(null); setChartMetrics(null); setKpiMetrics(null); setPostMetrics(null); return }
    const monthNum = MONTHS.indexOf(month) + 1
    let alive = true
    setTableMetrics(null); setChartMetrics(null); setKpiMetrics(null); setPostMetrics(null)
    const base = `/api/organizations/${encodeURIComponent(orgId)}/reports`
    const qs = `brand=${encodeURIComponent(brandId)}&year=${year}&month=${monthNum}`
    fetch(`${base}/table-metrics?${qs}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: ReportTableMetrics | null) => { if (alive) setTableMetrics(d) })
      .catch(e => { if (alive) { console.error('[report] table metrics fetch failed:', e); setTableMetrics(null) } })
    fetch(`${base}/chart-metrics?${qs}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: ReportChartMetrics | null) => { if (alive) setChartMetrics(d) })
      .catch(e => { if (alive) { console.error('[report] chart metrics fetch failed:', e); setChartMetrics(null) } })
    fetch(`${base}/kpi-metrics?${qs}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: ReportKpiMetrics | null) => { if (alive) setKpiMetrics(d) })
      .catch(e => { if (alive) { console.error('[report] kpi metrics fetch failed:', e); setKpiMetrics(null) } })
    fetch(`${base}/post-metrics?${qs}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: ReportPostMetrics | null) => { if (alive) setPostMetrics(d) })
      .catch(e => { if (alive) { console.error('[report] post metrics fetch failed:', e); setPostMetrics(null) } })
    return () => { alive = false }
  }, [orgId, brandId, month, year])

  // Auto-fill the cover logo from the selected brand's logo (public.brands.profile_url),
  // treated exactly like an uploaded logo (fetched to a data URL + palette extracted).
  // A manual upload overrides it; switching brand re-loads the new brand's logo.
  useEffect(() => {
    if (logoIsManual) return
    const url = brands.find(b => b.id === brandId)?.logo ?? null
    if (!url) { setLogoDataUrl(null); return }
    let alive = true
    urlToDataUrl(url).then(async dataUrl => {
      if (!alive || !dataUrl) return
      setLogoDataUrl(dataUrl)
      const palette = await extractPalette(dataUrl)
      if (alive && palette) setColors(palette)
    })
    return () => { alive = false }
  }, [brandId, brands, logoIsManual])

  const template = getTemplate(templateId)
  const kpiSlot = typeof configBlock === 'string' && configBlock.startsWith('kpi-') ? Number(configBlock.slice(4)) : null

  function addSlide(type: SlideType, channel = 'instagram') {
    const s = makeSlide(type, ++slideSeq, channel)
    setSlides(prev => [...prev, s])
    return s
  }
  function updateSlide(next: ContentSlide) {
    setSlides(prev => prev.map(s => (s.id === next.id ? next : s)))
  }
  function deleteSlide(id: string) {
    setSlides(prev => prev.filter(s => s.id !== id))
  }
  function openSlide(id: string) {
    setActiveSlideId(id)
    setStep('editSlide')
  }
  function pickSlideType(type: SlideType, channel: string) {
    setPickerOpen(false)
    openSlide(addSlide(type, channel).id)
  }
  function applyChart(config: ChartConfig) {
    if (activeSlide && (configBlock === 'chart' || configBlock === 'chartA' || configBlock === 'chartB')) {
      updateSlide({ ...activeSlide, [configBlock]: config })
    }
    setConfigBlock(null)
  }
  function applyTable(config: TableConfig) {
    if (activeSlide) updateSlide({ ...activeSlide, table: config })
    setConfigBlock(null)
  }
  function applyMetric(key: string) {
    const slot = typeof configBlock === 'string' && configBlock.startsWith('kpi-') ? Number(configBlock.slice(4)) : null
    if (activeSlide && slot !== null) {
      const next = [...activeSlide.kpiMetrics]
      next[slot] = key
      updateSlide({ ...activeSlide, kpiMetrics: next })
    }
    setConfigBlock(null)
  }

  // Per-slide chrome (footer + page numbers). Cover is page 1; content slides follow.
  const chromeFor = (index: number): SlideChrome => ({
    brandName,
    period,
    preparedBy: 'Sekata',
    logoDataUrl,
    pageNumber: index + 2,
    totalPages: slides.length + 1,
    template,
    mode,
    font,
  })

  function handleBrandChange(id: string) {
    setBrandId(id)
    setLogoIsManual(false)   // new brand → auto-load its logo (unless re-uploaded)
    const b = brands.find(x => x.id === id)
    if (b) setColors(c => ({ ...c, primary: b.color }))
  }

  async function handleLogo(file: File) {
    setLogoIsManual(true)    // manual upload overrides the brand's auto logo
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      setLogoDataUrl(dataUrl)
      const palette = await extractPalette(dataUrl)
      if (palette) setColors(palette)
    }
    reader.readAsDataURL(file)
  }

  const { toast, showToast, clearToast } = useToast()

  async function handleExport(exportMode: 'export' | 'export-save' = 'export') {
    setIsExporting(true)
    try {
      const cover = { brandName, title, subtitle, period, logoDataUrl, colors, mode, template, font }
      const { blob, fileName } = slides.length === 0
        ? await exportCoverPptx(cover)
        : await exportReportPptx({ cover, slides, chromes: slides.map((_, i) => chromeFor(i)), colors, brandName, font, metrics: tableMetrics, chartMetrics, kpiMetrics, postMetrics })

      downloadBlob(blob, fileName)

      if (exportMode === 'export-save') {
        const coverImage = await captureCover()
        const result = await saveExportToLibrary(orgId, blob, fileName, {
          title,
          brandName,
          period,
          slideCount: slides.length + 1, // + cover
          config: { subtitle, brandId, templateId, mode, colors, month, year },
          coverImage,
        })
        if (result.ok) {
          router.refresh()
          showToast('success', 'Report berhasil disimpan ke reports library organisasi.')
        } else {
          showToast('error', `File terunduh, tapi gagal menyimpan ke library:\n${result.error ?? 'Unknown error'}`)
        }
      }
    } catch (err) {
      console.error(err)
      showToast('error', 'Export gagal. Cek console untuk detail.')
    } finally {
      setIsExporting(false)
    }
  }

  // Apply a saved template from the Setup step: replace slides + cover style only.
  // Brand/period/colors/logo stay as the user set them. Returns false if cancelled.
  function applyTemplate(config: ReportTemplateConfig): boolean {
    if (slides.length > 0 && !window.confirm('Replace the current slides with this template’s structure?')) return false
    setSlides(seedTemplateSlides(config.slides))
    setTemplateId(config.cover.templateId)
    setMode(config.cover.mode)
    setFont(config.cover.font)
    setTitle(config.cover.title)
    setSubtitle(config.cover.subtitle)
    return true
  }

  // Persist the current report structure as a reusable template. Called by the
  // Save Template modal (which owns the name field + loading/error state).
  async function saveTemplate(name: string): Promise<{ ok: boolean; error?: string }> {
    // A template = structure only: cover style + slides, no brand/period/data.
    const config: ReportTemplateConfig = {
      cover: { templateId, mode, font, title, subtitle },
      slides,
    }
    const res = await saveTemplateToLibrary(orgId, name, brandName || null, config)
    if (res.ok) router.refresh()
    return res
  }

  return (
    <ReportAIContext.Provider value={{ orgId, brandName, period }}>
    <ReportMetricsContext.Provider value={tableMetrics}>
    <ReportChartContext.Provider value={chartMetrics}>
    <ReportKpiContext.Provider value={kpiMetrics}>
    <ReportPostContext.Provider value={postMetrics}>
    <div className="min-h-screen bg-[#f7f8f9]">
      <ToastHost toast={toast} onClose={clearToast} />
      {/* Off-screen full-size cover — rasterized to a PNG for the history preview */}
      <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 1200, pointerEvents: 'none', zIndex: -1 }}>
        <div ref={coverCaptureRef}>
          <CoverPreview
            brandName={brandName}
            title={title} subtitle={subtitle} period={period}
            logoDataUrl={logoDataUrl} colors={colors} mode={mode} template={template} font={font}
          />
        </div>
      </div>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-[#e5e7eb] px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          {onExit && (
            <button
              onClick={onExit}
              title="Back to reports"
              className="w-9 h-9 flex items-center justify-center bg-white border border-[#e5e7eb] rounded-lg text-[#6b7280] hover:text-[#1e4f49] hover:border-[#d1d5db] transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
          )}
          <div>
            <p style={PJ} className="text-[11px] text-[#94a3b8] font-semibold tracking-wide uppercase">
              New report · {orgName}
            </p>
            <h1 style={PJ} className="text-[21px] font-bold text-[#0f172a] tracking-[-0.03em] leading-none mt-1">
              {step === 'setup' ? 'Report setup' : step === 'cover' ? 'Design cover' : 'Build slides'}
            </h1>
          </div>
        </div>
        <Stepper step={step} />
      </header>

      <div className="px-8 py-8">
        {step === 'setup' && (
          <SetupStep
            brands={brands}
            templates={templates}
            onUseTemplate={applyTemplate}
            brandId={brandId} onBrand={handleBrandChange}
            month={month} setMonth={setMonth} year={year} setYear={setYear}
            title={title} setTitle={setTitle} subtitle={subtitle} setSubtitle={setSubtitle}
            font={font} setFont={setFont}
            onContinue={() => setStep('cover')}
          />
        )}

        {step === 'cover' && (
          <div className="grid grid-cols-12 gap-8">
            {/* Controls */}
            <div className="col-span-12 lg:col-span-4 space-y-5">
              <Panel title="Logo" icon="image">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && handleLogo(e.target.files[0])}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-[#d1d5db] rounded-lg py-5 text-center hover:border-[#3d7e96] hover:bg-[#f0f7f5] transition-colors"
                >
                  <span className="material-symbols-outlined text-[26px] text-[#9ca3af]">upload</span>
                  <p style={PJ} className="text-[12.5px] font-semibold text-[#374151] mt-1">
                    {logoDataUrl ? 'Replace logo' : 'Upload brand logo'}
                  </p>
                  <p className="text-[11px] text-[#9ca3af] mt-0.5">Colors are extracted automatically</p>
                </button>
              </Panel>

              <Panel title="Template" icon="dashboard">
                <div className="grid grid-cols-3 gap-2">
                  {COVER_TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      title={t.description}
                      className={`rounded-lg overflow-hidden ring-2 transition-all ${
                        t.id === templateId ? 'ring-[#3d7e96]' : 'ring-transparent hover:ring-[#d1d5db]'
                      }`}
                    >
                      <div
                        className="aspect-video"
                        style={{
                          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(t.background(colors, mode))}")`,
                          backgroundSize: 'cover',
                        }}
                      />
                      <div style={PJ} className="text-[10px] font-semibold text-[#374151] py-1 bg-white">
                        {t.name}
                      </div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Colors" icon="palette">
                <div className="space-y-2.5">
                  {(['primary', 'secondary', 'accent'] as const).map(key => (
                    <div key={key} className="flex items-center justify-between">
                      <span style={PJ} className="text-[12px] font-medium text-[#374151] capitalize">{key}</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={colors[key]}
                          onChange={e => setColors(c => ({ ...c, [key]: normalizeHex(e.target.value) }))}
                          className="w-8 h-8 rounded cursor-pointer border border-[#e5e7eb] bg-white"
                        />
                        <span className="text-[11px] text-[#9ca3af] font-mono w-[62px]">{colors[key]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Appearance" icon="contrast">
                <div className="flex items-center bg-[#f3f4f6] rounded-lg p-0.5">
                  {(['light', 'dark'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      style={PJ}
                      className={`flex-1 h-8 rounded-md text-[12px] font-semibold capitalize transition-colors ${
                        mode === m ? 'bg-white text-[#1e4f49] shadow-sm' : 'text-[#6b7280] hover:text-[#374151]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Text" icon="title">
                <Field label="Title" value={title} onChange={setTitle} />
                <Field label="Subtitle" value={subtitle} onChange={setSubtitle} />
              </Panel>
            </div>

            {/* Preview — enlarged, centered, presented on an elegant stage */}
            <div className="col-span-12 lg:col-span-8">
              <div className="sticky top-[72px] h-[calc(100vh-72px)] flex items-center justify-center">
                <div className="w-full max-w-[860px] rounded-[28px] border border-[#e7ebed] bg-gradient-to-b from-[#fcfdfd] to-[#eef2f4] p-7 lg:p-10 shadow-[0_1px_3px_rgba(16,24,40,0.05)]">

                  {/* Caption */}
                  <div className="flex items-center justify-between mb-6 px-1">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-[#1e4f49] opacity-60 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1e4f49]" />
                      </span>
                      <span style={PJ} className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#94a3b8]">
                        Live preview
                      </span>
                    </div>
                    <span style={PJ} className="text-[11px] font-semibold text-[#64748b] bg-white border border-[#e7ebed] px-2.5 py-1 rounded-full">
                      {template.name}
                    </span>
                  </div>

                  {/* Cover with deep, soft shadow */}
                  <div className="rounded-2xl shadow-[0_30px_60px_-22px_rgba(16,24,40,0.40)]">
                    <CoverPreview
                      brandName={brandName}
                      title={title} subtitle={subtitle} period={period}
                      logoDataUrl={logoDataUrl} colors={colors} mode={mode} template={template} font={font}
                    />
                  </div>

                  {/* Meta + continue */}
                  <div className="flex items-center justify-between mt-6 px-1">
                    <div className="min-w-0">
                      <p style={PJ} className="text-[13.5px] font-bold text-[#0f172a] truncate">{brandName || 'No brand'}</p>
                      <p className="text-[12px] text-[#94a3b8] mt-0.5">{period} · 16:9 · PPTX</p>
                    </div>
                    <button
                      onClick={() => setStep('slides')}
                      style={PJ}
                      className="flex items-center gap-2 bg-[#1e4f49] hover:bg-[#163a35] text-white text-[13px] font-bold px-5 py-2.5 rounded-xl shadow-[0_4px_14px_rgba(30,79,73,0.30)] transition-colors flex-shrink-0"
                    >
                      Continue to slides
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'slides' && (
          <SlidesReview
            slides={slides}
            colors={colors}
            isExporting={isExporting}
            chromeFor={chromeFor}
            onAdd={() => setPickerOpen(true)}
            onOpen={openSlide}
            onRename={(id, t) => updateSlide({ ...slides.find(s => s.id === id)!, title: t })}
            onDelete={deleteSlide}
            onExport={handleExport}
            onSaveTemplate={() => setSaveTemplateOpen(true)}
            cover={
              <CoverPreview
                brandName={brandName}
                title={title} subtitle={subtitle} period={period}
                logoDataUrl={logoDataUrl} colors={colors} mode={mode} template={template}
              />
            }
            onEditCover={() => setStep('cover')}
          />
        )}

        {step === 'editSlide' && activeSlide && (
          <SlideEditor
            slide={activeSlide}
            colors={colors}
            chrome={chromeFor(activeIndex)}
            index={activeIndex}
            total={slides.length}
            onChange={updateSlide}
            onConfigure={setConfigBlock}
            onBack={() => setStep('slides')}
            onPrev={activeIndex > 0 ? () => setActiveSlideId(slides[activeIndex - 1].id) : undefined}
            onNext={
              activeIndex < slides.length - 1
                ? () => setActiveSlideId(slides[activeIndex + 1].id)
                : () => setPickerOpen(true)
            }
            nextIsAdd={activeIndex >= slides.length - 1}
          />
        )}
      </div>

      <SlideTypePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={pickSlideType} />

      <ChartSelectionModal
        open={configBlock === 'chart' || configBlock === 'chartA' || configBlock === 'chartB'}
        allowWordCloud={activeSlide?.type === 'comparison'}
        onClose={() => setConfigBlock(null)}
        onSelect={applyChart}
      />

      <TableSelectionModal
        open={configBlock === 'table'}
        initial={activeSlide?.table ?? null}
        channel={activeSlide?.channel ?? 'instagram'}
        onClose={() => setConfigBlock(null)}
        onConfirm={applyTable}
      />

      <MetricPickerModal
        open={typeof configBlock === 'string' && configBlock.startsWith('kpi-')}
        current={kpiSlot !== null && activeSlide ? activeSlide.kpiMetrics[kpiSlot] ?? null : null}
        channel={activeSlide?.channel ?? 'instagram'}
        onClose={() => setConfigBlock(null)}
        onSelect={applyMetric}
      />

      <SaveTemplateModal
        open={saveTemplateOpen}
        defaultName={title || 'My report template'}
        onClose={() => setSaveTemplateOpen(false)}
        onSave={saveTemplate}
      />
    </div>
    </ReportPostContext.Provider>
    </ReportKpiContext.Provider>
    </ReportChartContext.Provider>
    </ReportMetricsContext.Provider>
    </ReportAIContext.Provider>
  )
}
