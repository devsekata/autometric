'use server'

import { signOut } from '@/auth'
import { clearWorkspaceMode } from './workspaceMode'

export async function logout() {
  // Forget the chosen workspace mode first: it belongs to the session, not to
  // the browser, so the next person to sign in here is asked again rather than
  // silently inheriting this one's choice.
  await clearWorkspaceMode()
  await signOut({ redirectTo: '/login' })
}
