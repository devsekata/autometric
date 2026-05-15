import { auth } from '@/auth'
import { redirect } from 'next/navigation'

export default async function AuthErrorPage() {
  const session = await auth()
  redirect(session?.user ? '/organizations' : '/login')
}
