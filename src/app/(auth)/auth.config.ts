import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  pages: {
    signIn: '/login',
    newUser: '/',
  },
  providers: [
    // Credentials providers are added in auth.ts (they need bcrypt, which is
    // Node-only; this config is also imported in the edge middleware).
  ],
  callbacks: {},
} satisfies NextAuthConfig
