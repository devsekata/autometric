import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import AuthPage from '@/components/auth/AuthPage'

export default async function LoginPage() {
  const session = await auth()
  if (session?.user) redirect('/')
  return <AuthPage />
}
