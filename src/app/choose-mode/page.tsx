import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { listOrgsForUser } from '@/lib/organizations/queries'
import { availableModes, chooseWorkspaceMode } from '@/lib/auth/workspaceMode'
import WorkspaceModeChooser from '@/components/auth/WorkspaceModeChooser'
import type { OrgRole } from '@/lib/organizations/viewRole'

/**
 * The screen between signing in and entering the workspace.
 *
 * It sits on its own route rather than inside the dashboard because it is not
 * part of the workspace: it decides which workspace you get. Both `/` and the
 * dashboard layout send people here when no mode has been chosen, so a deep
 * link into a campaign is caught by the same gate as a fresh login.
 *
 * A user with no organizations skips it. Mode is a question about how to use a
 * workspace, and asking it before there is one to use is a question with no
 * meaning — they go to the welcome screen to create or join one first.
 */
export default async function ChooseModePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const userId = session.user?.id ?? ''
  const orgs = await listOrgsForUser(userId)
  if (orgs.length === 0) redirect('/')

  const modes = await availableModes()

  async function pick(mode: OrgRole) {
    'use server'
    // Re-validated inside `chooseWorkspaceMode` against the real memberships,
    // so the value posted from the browser cannot grant anything.
    await chooseWorkspaceMode(mode)

    // Re-read rather than closing over the list rendered above: a server action
    // serialises everything it captures, and the destination is one slug.
    const session = await auth()
    const mine = await listOrgsForUser(session?.user?.id ?? '')
    if (mine.length === 0) redirect('/')

    // Straight into the workspace they were last in, which is what "Enter
    // Dashboard" means here. Falls back to the first org they belong to.
    const store = await cookies()
    const last = store.get('last_org_slug')?.value
    const slug = mine.find(o => o.slug === last)?.slug ?? mine[0].slug
    redirect(`/organizations/${slug}/dashboard`)
  }

  return (
    <WorkspaceModeChooser
      userName={session.user?.name ?? null}
      available={modes}
      onChoose={pick}
    />
  )
}
