import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { validateCredentials } from '@/lib/auth/validateCredentials'
import { handleGoogleSignIn, getDbUserIdByEmail, getDbUserByEmail } from '@/lib/auth/handleGoogleSignIn'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      id: 'google-one-tap',
      credentials: { idToken: { type: 'text' } },
      async authorize(credentials) {
        const idToken = credentials?.idToken as string
        if (!idToken) return null

        const res = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
        )
        if (!res.ok) return null

        const payload = await res.json()
        if (payload.aud !== process.env.GOOGLE_CLIENT_ID) return null

        const email = payload.email as string
        const name = (payload.name || email) as string
        const googleId = payload.sub as string
        const avatarUrl = (payload.picture ?? null) as string | null

        await handleGoogleSignIn({ email, name, googleId, avatarUrl })

        const id = await getDbUserIdByEmail(email)
        if (!id) return null

        return { id, email, name }
      },
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string
        const password = credentials?.password as string
        if (!email || !password) return null
        return validateCredentials(email, password)
      },
    }),
  ],
  pages: {
    signIn: '/login',
    error: '/auth-error',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true
      try {
        await handleGoogleSignIn({
          email: user.email!,
          name: user.name || user.email!,
          googleId: account.providerAccountId,
          avatarUrl: user.image ?? null,
        })
      } catch (e) {
        console.error('[auth] handleGoogleSignIn error:', e)
      }
      return true
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnOrganizations = nextUrl.pathname.startsWith('/organizations')
      const isOnLogin = nextUrl.pathname.startsWith('/login')
      if (isOnOrganizations && !isLoggedIn) return false
      if (isOnLogin && isLoggedIn) return Response.redirect(new URL('/', nextUrl))
      return true
    },
    async jwt({ token, user, account }) {
      if (user?.id) token.id = user.id
      if (account?.provider === 'google' && token.email) {
        try {
          const dbUser = await getDbUserByEmail(token.email)
          if (dbUser) {
            token.id = dbUser.id
            token.name = dbUser.name
          }
        } catch (e) {
          console.error('[auth] getDbUserByEmail error:', e)
        }
      }
      return token
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      if (token.name) session.user.name = token.name
      return session
    },
  },
})
