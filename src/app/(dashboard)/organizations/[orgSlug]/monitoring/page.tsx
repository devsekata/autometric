import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import type { PlatformSyncRow } from '@/lib/monitoring/queries'
import MonitoringPage from '@/components/monitoring/MonitoringPage'

type Props = { params: Promise<{ orgSlug: string }> }

const now = Date.now()
const hoursAgo = (h: number) => new Date(now - h * 36e5).toISOString()

const DUMMY_DATA: PlatformSyncRow[] = [
  // Brand: Kopiko
  {
    brandId: 'brand-1', brandName: 'Kopiko',
    platform: 'instagram', socialAccountId: 'sa-1',
    username: 'kopiko.id', lastProfileSync: hoursAgo(3), dataCount: 214,
  },
  {
    brandId: 'brand-1', brandName: 'Kopiko',
    platform: 'tiktok', socialAccountId: 'sa-2',
    username: 'kopiko.id', lastProfileSync: hoursAgo(50), dataCount: 87,
  },
  {
    brandId: 'brand-1', brandName: 'Kopiko',
    platform: 'facebook', socialAccountId: 'sa-3',
    username: 'KopikoIndonesia', lastProfileSync: hoursAgo(200), dataCount: 312,
  },
  // Brand: Indomie
  {
    brandId: 'brand-2', brandName: 'Indomie',
    platform: 'instagram', socialAccountId: 'sa-4',
    username: 'indomie', lastProfileSync: hoursAgo(1), dataCount: 589,
  },
  {
    brandId: 'brand-2', brandName: 'Indomie',
    platform: 'tiktok', socialAccountId: 'sa-5',
    username: 'indomie_id', lastProfileSync: null, dataCount: 0,
  },
  // Brand: Tokopedia
  {
    brandId: 'brand-3', brandName: 'Tokopedia',
    platform: 'instagram', socialAccountId: 'sa-6',
    username: 'tokopedia', lastProfileSync: hoursAgo(100), dataCount: 1043,
  },
  {
    brandId: 'brand-3', brandName: 'Tokopedia',
    platform: 'facebook', socialAccountId: 'sa-7',
    username: 'Tokopedia', lastProfileSync: hoursAgo(18), dataCount: 768,
  },
]

export default async function Page({ params }: Props) {
  const { orgSlug } = await params
  const session     = await auth()

  if (session?.user?.role !== 'ADMIN') notFound()

  return <MonitoringPage orgSlug={orgSlug} data={DUMMY_DATA} />
}
