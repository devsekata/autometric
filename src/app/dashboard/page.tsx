import { auth } from '@/auth'
import Image from 'next/image'
import LogoutButton from './LogoutButton'

export default async function DashboardPage() {
  const session = await auth()
  const user = session!.user

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f1f8' }}>

      {/* Navbar */}
      <header className="h-16 bg-white border-b border-outline-variant flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined fill text-on-primary" style={{ fontSize: 16 }}>insert_chart</span>
          </div>
          <span className="font-h3 text-h3 text-on-surface tracking-tight">Autometric</span>
        </div>

        <LogoutButton />
      </header>

      {/* Body */}
      <main className="flex-1 flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-outline-variant p-8 flex flex-col items-center gap-4 w-full max-w-sm">

          {user.image ? (
            <Image
              src={user.image}
              alt={user.name ?? 'Avatar'}
              width={72}
              height={72}
              className="rounded-full"
            />
          ) : (
            <div className="w-[72px] h-[72px] rounded-full bg-primary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 32 }}>person</span>
            </div>
          )}

          <div className="text-center">
            <p className="font-h3 text-h3 text-on-surface">{user.name ?? '—'}</p>
            <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">{user.email}</p>
          </div>

          <div className="w-full border-t border-outline-variant pt-4 flex flex-col gap-2">
            <div className="flex justify-between">
              <span className="font-body-md text-body-md text-on-surface-variant">User ID</span>
              <span className="font-body-md text-body-md text-on-surface font-medium">{user.id}</span>
            </div>
          </div>

        </div>
      </main>

    </div>
  )
}
