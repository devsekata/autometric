import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { DUMMY_ORGS, getOrgBySlug } from '@/lib/organizations/dummy'
import WelcomePage from '@/components/organizations/WelcomePage'

export default async function HomePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const cookieStore = await cookies()
  const lastSlug    = cookieStore.get('last_org_slug')?.value

  const hasOrgs = DUMMY_ORGS.length > 0

  // Pakai last org jika valid, fallback ke org pertama
  const targetSlug =
    (lastSlug && getOrgBySlug(lastSlug) ? lastSlug : null) ??
    DUMMY_ORGS[0]?.slug ??
    ''

  return <WelcomePage hasOrgs={hasOrgs} firstOrgSlug={targetSlug} />
}
