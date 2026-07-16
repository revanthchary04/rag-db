import { compare } from 'bcrypt-ts'
import NextAuth, { type DefaultSession } from 'next-auth'
import type { DefaultJWT } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'
import { DUMMY_PASSWORD, isTestEnvironment } from '@/lib/constants'
import { createGuestUser, getUser } from '@/lib/db/queries'
import { authConfig } from './auth.config'

export type UserType = 'guest' | 'regular'

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string
      type: UserType
    } & DefaultSession['user']
  }

  interface User {
    id?: string
    email?: string | null
    type: UserType
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string
    type: UserType
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async authorize({ email, password }: any) {
        const users = await getUser(email)

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD)
          return null
        }

        const [user] = users

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD)
          return null
        }

        const passwordsMatch = await compare(password, user.password)
        if (!passwordsMatch) {
          return null
        }

        return { ...user, type: 'regular' }
      },
    }),
    Credentials({
      id: 'guest',
      credentials: {},
      async authorize() {
        // In Playwright the DB is mocked at the network boundary; return a
        // stub guest so the app loads without a real Postgres.
        if (isTestEnvironment) {
          return {
            id: '00000000-0000-4000-8000-000000000000',
            email: 'guest-test',
            type: 'guest',
          }
        }
        const [guestUser] = await createGuestUser()
        return { ...guestUser, type: 'guest' }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.type = user.type
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.type = token.type
      }
      return session
    },
  },
})
