'use client'

import { useState } from 'react'
import { CoverColors } from '@/lib/reports/cover/colors'
import { SlideChrome } from '@/lib/reports/data/slideModel'
import { PLATFORM_META } from '@/components/dashboard/data'

export const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export function Placeholder({ icon, label, editable, onClick }: { icon?: string; label: string; editable: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={editable ? onClick : undefined}
      disabled={!editable}
      className={`w-full h-full flex flex-col items-center justify-center rounded-[1.4cqw] border-2 border-dashed transition-colors ${
        editable ? 'border-[#cbd5e1] text-[#94a3b8] hover:border-[#1e4f49] hover:text-[#1e4f49] hover:bg-[#f2f8f5] cursor-pointer' : 'border-[#dbe1e8] text-[#b6bcc4] cursor-default'
      }`}
      style={{ background: 'rgba(255,255,255,0.45)' }}
    >
      {icon && <span className="material-symbols-outlined" style={{ fontSize: '3.8cqw', marginBottom: '1cqh' }}>{icon}</span>}
      <span style={{ fontSize: '1.35cqw', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', ...PJ }}>{label}</span>
    </button>
  )
}

export function Card({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{ background: '#ffffff', border: '1px solid #e8ebee', borderRadius: '1.4cqw', boxShadow: '0 1cqh 2.4cqh -1.4cqh rgba(16,24,40,0.18)', height: '100%', ...style }}
    >
      {children}
    </div>
  )
}

export function CardLabel({ children, icon, accent, onEdit }: { children: React.ReactNode; icon?: string; accent?: string; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between" style={{ ...PJ }}>
      <div className="flex items-center min-w-0" style={{ gap: '0.6cqw', fontSize: '1.2cqw', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {icon && <span className="material-symbols-outlined" style={{ fontSize: '1.6cqw', color: accent }}>{icon}</span>}
        <span className="truncate">{children}</span>
      </div>
      {onEdit && (
        <button onClick={onEdit} className="material-symbols-outlined" style={{ fontSize: '1.7cqw', color: '#cbd5e1' }} title="Reconfigure">tune</button>
      )}
    </div>
  )
}

export function Title({ value, editable, onChange }: { value: string; editable: boolean; onChange?: (v: string) => void }) {
  if (editable) {
    return (
      <input
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder="Slide title"
        style={{ fontSize: '2.8cqw', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', background: 'transparent', outline: 'none', width: '100%', ...PJ }}
        className="placeholder:text-slate-300"
      />
    )
  }
  return (
    <div className="truncate" style={{ fontSize: '2.8cqw', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', ...PJ }}>
      {value || 'Untitled slide'}
    </div>
  )
}

export function ChannelBadge({ channel }: { channel: string }) {
  const meta = PLATFORM_META[channel as keyof typeof PLATFORM_META]
  if (!meta) return null
  return (
    <div className="flex items-center" style={{ gap: '0.7cqw', background: '#f1f5f9', borderRadius: '999px', padding: '0.7cqh 1.3cqw' }}>
      <img src={meta.logo} alt={meta.label} style={{ width: '1.6cqw', height: '1.6cqw', objectFit: 'contain' }} />
      <span style={{ fontSize: '1.2cqw', fontWeight: 700, color: '#475569', ...PJ }}>{meta.label}</span>
    </div>
  )
}

export function InsightsBlock({ value, editable, onChange, label = 'Key insights' }: { value: string; editable: boolean; onChange?: (v: string) => void; label?: string }) {
  const [editing, setEditing] = useState(false)
  const style: React.CSSProperties = { fontSize: '1.45cqw', color: '#475569', lineHeight: 1.55, ...PJ }

  if (!value && !editing) {
    return <Placeholder icon="auto_awesome" label={label === 'Key insights' ? 'AI Key Insights' : label} editable={editable} onClick={() => editable && setEditing(true)} />
  }
  return (
    <Card style={{ padding: '2cqh 1.8cqw', display: 'flex', flexDirection: 'column', gap: '1.4cqh' }}>
      <CardLabel icon="auto_awesome" accent="#1e4f49">{label}</CardLabel>
      <div className="flex-1 min-h-0">
        {editable ? (
          <textarea
            autoFocus={editing && !value}
            value={value}
            onChange={e => onChange?.(e.target.value)}
            placeholder="• Type a key insight per line…"
            style={{ ...style, width: '100%', height: '100%', background: 'transparent', outline: 'none', resize: 'none' }}
            className="placeholder:text-slate-300"
          />
        ) : (
          <div className="whitespace-pre-wrap overflow-hidden" style={{ ...style, height: '100%' }}>{value}</div>
        )}
      </div>
    </Card>
  )
}

export function Footer({ chrome, colors }: { chrome: SlideChrome; colors: CoverColors }) {
  const tint8 = `${colors.primary}14` // ~8% alpha
  return (
    <div style={{ position: 'relative', paddingTop: '1.5cqh' }}>
      {/* Gradient accent line at top */}
      <div className="absolute top-0 left-0 right-0 rounded-full" style={{ height: '0.35cqh', background: `linear-gradient(90deg, ${colors.primary} 0%, ${colors.primary}55 50%, ${colors.primary} 100%)` }} />

      <div className="flex items-center" style={{ paddingTop: '1.4cqh' }}>
        {/* Left — logo box · period */}
        <div className="flex items-center flex-1" style={{ gap: '1.2cqw' }}>
          {chrome.logoDataUrl ? (
            <span className="flex items-center justify-center" style={{ padding: '0.6cqh 0.7cqw', borderRadius: '0.8cqw', background: tint8 }}>
              <img src={chrome.logoDataUrl} alt="logo" style={{ height: '2.6cqh', maxWidth: '10cqw', objectFit: 'contain' }} />
            </span>
          ) : (
            <span className="flex items-center justify-center" style={{ width: '3.4cqh', height: '3.4cqh', borderRadius: '0.7cqw', background: colors.primary, color: '#fff', fontSize: '1.35cqw', fontWeight: 800, ...PJ }}>
              {chrome.brandName.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="rounded-full" style={{ width: '0.8cqw', height: '0.8cqw', background: colors.primary }} />
          <span style={{ fontSize: '1.25cqw', fontWeight: 600, color: '#475569', ...PJ }}>{chrome.period}</span>
        </div>

        {/* Center — prepared by */}
        <div className="flex-1 flex flex-col items-center" style={{ gap: '0.2cqh' }}>
          {chrome.preparedBy && (
            <>
              <span style={{ fontSize: '0.9cqw', color: '#94a3b8', ...PJ }}>Prepared by</span>
              <span style={{ fontSize: '1.1cqw', fontWeight: 700, color: '#475569', ...PJ }}>{chrome.preparedBy}</span>
            </>
          )}
        </div>

        {/* Right — page pill */}
        <div className="flex-1 flex justify-end">
          <div className="flex items-center" style={{ gap: '0.5cqw', padding: '0.4cqh 1.2cqw', borderRadius: '999px', background: tint8, ...PJ }}>
            <span style={{ fontSize: '1.2cqw', fontWeight: 700, color: colors.primary }}>{chrome.pageNumber}</span>
            <span style={{ fontSize: '1.2cqw', color: '#cbd5e1' }}>/</span>
            <span style={{ fontSize: '1.2cqw', color: '#94a3b8' }}>{chrome.totalPages}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
