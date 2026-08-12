'use client'

/**
 * Workspace › Settings — port of the source platform's `pages/settings.js`
 * (Brand/Admin role): Account · Profile · Notifications · Integrations ·
 * Workspace · Roles & Permissions.
 *
 * The source's switches were decorative — every toggle flipped a CSS class and
 * fired a toast, and the Influencer role it also shipped configured a creator's
 * own account, which is not a thing a brand workspace can edit. So this reads
 * the real configuration behind each tab and, where autometric owns the setting
 * elsewhere, links to the page that actually writes it.
 *
 * Fake switches wired to real infrastructure settings would be worse than not
 * shipping them: a toggle that appears to disable notifications, and doesn't, is
 * a support ticket waiting to happen.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, DiscoverHeader, PJ, TabStrip, fmtDate } from './ui'
import type { OrgMember } from '@/lib/organizations/members'

type TabId = 'account' | 'profile' | 'notifications' | 'integrations' | 'workspace' | 'roles'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'account', label: 'Account', icon: 'manage_accounts' },
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  { id: 'integrations', label: 'Integrations', icon: 'hub' },
  { id: 'workspace', label: 'Workspace', icon: 'corporate_fare' },
  { id: 'roles', label: 'Roles & Permissions', icon: 'shield_person' },
]

export interface WorkspaceSettingsData {
  orgName: string
  orgSlug: string
  createdAt: string | null
  brandCount: number
  memberCount: number
  myRole: 'ADMIN' | 'MEMBER'
  members: OrgMember[]
  viewer: { name: string | null; email: string | null }
  /** Platforms with at least one connected account, from the Discover roster. */
  platforms: { platform: string; accounts: number }[]
  paymentConfigured: boolean
  aiConfigured: boolean
}

export default function WorkspaceSettings({
  data, orgSlug,
}: { data: WorkspaceSettingsData; orgSlug: string }) {
  const [tab, setTab] = useState<TabId>('account')
  const base = `/organizations/${orgSlug}`

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <DiscoverHeader
        title="Settings"
        subtitle="Konfigurasi workspace ini. Yang bisa diubah ditautkan ke halaman yang benar-benar menyimpannya."
      />

      <TabStrip tabs={TABS} value={tab} onChange={setTab} />

      <div className="mt-4 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {tab === 'account' && (
          <>
            <Card>
              <CardHead title="Login & Security" sub="Akun yang sedang dipakai" />
              <div className="px-4 pb-4 flex flex-col gap-2">
                <Row label="Nama" value={data.viewer.name ?? '—'} />
                <Row label="Email" value={data.viewer.email ?? '—'} />
                <Row label="Role di workspace ini" value={data.myRole === 'ADMIN' ? 'Admin' : 'Member'} />
                <Note>
                  Password dan two-factor dikelola lewat penyedia login akun, bukan di dalam workspace.
                </Note>
              </div>
            </Card>
            <Card>
              <CardHead title="Status akun" sub="Keanggotaan di organisasi ini" />
              <div className="px-4 pb-4">
                <Callout tone="good" icon="verified"
                  title={`Aktif sebagai ${data.myRole === 'ADMIN' ? 'Admin' : 'Member'}`}
                  body={data.myRole === 'ADMIN'
                    ? 'Kamu bisa mengundang anggota, mengubah role, dan mengelola brand di workspace ini.'
                    : 'Kamu bisa memakai seluruh modul. Perubahan anggota dan brand butuh role Admin.'} />
              </div>
            </Card>
          </>
        )}

        {tab === 'profile' && (
          <Card>
            <CardHead title="Profil workspace" sub="Identitas organisasi yang dipakai di seluruh produk" />
            <div className="px-4 pb-4 flex flex-col gap-2">
              <Row label="Nama organisasi" value={data.orgName} />
              <Row label="Slug" value={data.orgSlug} />
              <Row label="Dibuat" value={data.createdAt ? fmtDate(data.createdAt) : '—'} />
              <LinkOut href={`${base}/settings`} label="Ubah di Settings organisasi" />
            </div>
          </Card>
        )}

        {tab === 'notifications' && (
          <Card>
            <CardHead title="Notifikasi" sub="Status fitur" />
            <div className="px-4 pb-4">
              <Callout tone="warn" icon="notifications_off" title="Belum tersedia"
                body="Autometric belum mengirim notifikasi campaign atau laporan, jadi tidak ada preferensi yang bisa diatur di sini. Menampilkan tombol yang tidak menyimpan apa pun akan lebih menyesatkan daripada mengosongkannya." />
            </div>
          </Card>
        )}

        {tab === 'integrations' && (
          <>
            <Card>
              <CardHead title="Platform terhubung" sub="Dihitung dari akun yang ada di roster Discover" />
              <div className="px-4 pb-4 flex flex-col gap-2">
                {data.platforms.length === 0 ? (
                  <Note>Belum ada akun sosial yang terhubung.</Note>
                ) : data.platforms.map(p => (
                  <Row key={p.platform} label={<span className="capitalize">{p.platform}</span>}
                    value={`${p.accounts} akun`} />
                ))}
                <LinkOut href={`${base}/brands`} label="Kelola akun & kompetitor di Brands" />
              </div>
            </Card>
            <Card>
              <CardHead title="Layanan server" sub="Konfigurasi yang memengaruhi modul ini" />
              <div className="px-4 pb-4 flex flex-col gap-2">
                <Row label="Payment gateway"
                  value={data.paymentConfigured ? 'Aktif' : 'Belum dikonfigurasi'} />
                <Row label="AI (Gemini)"
                  value={data.aiConfigured ? 'Aktif' : 'Belum dikonfigurasi'} />
                <Note>
                  Keduanya diatur lewat environment variable di server, bukan per workspace.
                </Note>
              </div>
            </Card>
          </>
        )}

        {tab === 'workspace' && (
          <>
            <Card>
              <CardHead title="Isi workspace" sub="Apa yang ada di organisasi ini" />
              <div className="px-4 pb-4 flex flex-col gap-2">
                <Row label="Brand" value={String(data.brandCount)} />
                <Row label="Anggota" value={String(data.memberCount)} />
                <LinkOut href={`${base}/brands`} label="Buka Brands" />
              </div>
            </Card>
            <Card>
              <CardHead title="Konfigurasi Discover" sub="Akun, kompetitor dan content pillar yang dibaca modul ini" />
              <div className="px-4 pb-4">
                <Note>
                  Sumber data KOL Intelligence — akun brand, kompetitor yang dipantau, dan content
                  pillar — diatur di halaman Settings milik modul Discover.
                </Note>
                <LinkOut href={`${base}/discover/settings`} label="Buka Discover Settings" />
              </div>
            </Card>
          </>
        )}

        {tab === 'roles' && (
          <Card className="overflow-hidden md:col-span-2">
            <CardHead title="Roles & Permissions" sub={`${data.members.length} anggota di workspace ini`}
              action={<Link href={`${base}/members`}>
                <Btn size="sm" variant="secondary">
                  <span className="material-symbols-outlined text-[14px]">group</span>Kelola anggota
                </Btn>
              </Link>} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-[#e5e7eb]">
                    {['Anggota', 'Email', 'Role', 'Status', 'Bergabung'].map(h => (
                      <th key={h} style={PJ}
                        className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.members.map(m => (
                    <tr key={m.id} className="border-b border-[#f3f4f6] last:border-0">
                      <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#111827]">
                        {m.name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[#6b7280]">{m.email}</td>
                      <td className="px-3 py-2">
                        <span style={PJ}
                          className={`text-[9.5px] font-extrabold uppercase rounded px-1.5 py-0.5 ${
                            m.role === 'ADMIN' ? 'bg-[#f0f7fa] text-[#285D6E]' : 'bg-[#f3f4f6] text-[#6b7280]'
                          }`}>
                          {m.role}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span style={PJ}
                          className={`text-[9.5px] font-extrabold uppercase rounded px-1.5 py-0.5 ${
                            m.status === 'ACTIVE' ? 'bg-[#eaf5ef] text-[#3d8a5f]' : 'bg-[#fdf3e7] text-[#b5761f]'
                          }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[#9ca3af]">
                        {m.joined_at ? fmtDate(m.joined_at) : 'Belum bergabung'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-[11.5px] text-[#6b7280]">{label}</span>
      <span style={PJ} className="text-[11.5px] font-bold text-[#111827] text-right truncate">{value}</span>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] text-[#9ca3af] leading-relaxed mt-1">{children}</p>
}

function LinkOut({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mt-2 inline-flex">
      <Btn size="sm" variant="secondary">
        <span className="material-symbols-outlined text-[14px]">north_east</span>{label}
      </Btn>
    </Link>
  )
}

function Callout({
  tone, icon, title, body,
}: { tone: 'good' | 'warn'; icon: string; title: string; body: string }) {
  const c = tone === 'good'
    ? { bg: '#eaf5ef', border: '#c8e2d2', fg: '#3d8a5f' }
    : { bg: '#fdf3e7', border: '#eed9bb', fg: '#b5761f' }
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <span className="material-symbols-outlined text-[16px] mt-0.5" style={{ color: c.fg }}>{icon}</span>
      <div>
        <div style={{ ...PJ, color: c.fg }} className="text-[11.5px] font-extrabold">{title}</div>
        <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: c.fg }}>{body}</p>
      </div>
    </div>
  )
}
