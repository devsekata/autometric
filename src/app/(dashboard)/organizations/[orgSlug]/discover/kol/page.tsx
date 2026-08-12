import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import DiscoverKolWorkspace from '@/components/discover/DiscoverKolWorkspace'

interface Props { params: Promise<{ orgSlug: string }> }

export default async function DiscoverKolPage({ params }: Props) {
  const { orgSlug } = await params
  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  // The workspace reads the active tab from useSearchParams, which Next requires
  // to sit under a Suspense boundary — and which makes this subtree render on
  // the client only. An empty fallback would flash a blank page before hydration,
  // so the fallback carries the title and a spinner.
  return (
    <Suspense fallback={<WorkspaceFallback />}>
      <DiscoverKolWorkspace orgId={org.id} orgSlug={orgSlug} />
    </Suspense>
  )
}

function WorkspaceFallback() {
  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <h1
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        className="text-[19px] font-extrabold text-[#111827] tracking-[-0.02em]"
      >
        KOL Intelligence
      </h1>
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <span className="material-symbols-outlined text-[26px] text-[#A7C8D4] animate-spin">progress_activity</span>
        <span className="text-[12px] text-[#9ca3af]">Memuat…</span>
      </div>
    </div>
  )
}
