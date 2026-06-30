import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import Providers from '@/components/layout/Providers'
import AdminHeader from '@/components/admin/AdminHeader'
import AdminNav from '@/components/admin/AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session)                        redirect('/login')
  if (session.user?.role !== 'ADMIN')  redirect('/')

  return (
    <Providers session={session}>
      <div className="min-h-screen bg-[#f9fafb]">
        <AdminHeader userName={session.user?.name ?? ''} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: '210px 1fr',
          minHeight: 'calc(100vh - 56px)',
        }}>
          <AdminNav />
          <main style={{ padding: '32px', overflowX: 'hidden' }}>
            {children}
          </main>
        </div>
      </div>
    </Providers>
  )
}
