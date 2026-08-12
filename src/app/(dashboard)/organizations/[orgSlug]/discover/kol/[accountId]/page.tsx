import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import DiscoverKolDetail from '@/components/discover/DiscoverKolDetail'
import type { AccountRelation } from '@/lib/discover/account'

interface Props {
  params: Promise<{ orgSlug: string; accountId: string }>
  searchParams: Promise<{ relation?: string }>
}

export default async function DiscoverKolDetailPage({ params, searchParams }: Props) {
  const { orgSlug, accountId } = await params
  const { relation: raw } = await searchParams

  const session = await auth()
  const org = await getOrgBySlugForUser(orgSlug, session?.user?.id ?? '')
  if (!org) notFound()

  // The same account id can be both an owned account and a tracked competitor,
  // so the relation travels in the query string; anything else falls back to
  // 'owned' and the API answers 404 if that pairing does not exist.
  const relation: AccountRelation = raw === 'competitor' ? 'competitor' : 'owned'

  return (
    <DiscoverKolDetail orgId={org.id} orgSlug={orgSlug} accountId={accountId} relation={relation} />
  )
}
