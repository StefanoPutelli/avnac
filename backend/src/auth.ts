import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { defaultAc, userAc } from 'better-auth/plugins/admin/access'
import { and, eq, isNotNull } from 'drizzle-orm'
import { corsOrigins, env } from './config/env'
import { db } from './db'
import { document, user, userKey } from './db/schema'
import { HttpError } from './lib/http'

// No set-password / impersonate: setting a password directly would leave the user's data key
// locked with the old one. Admins reset passwords through links instead (routes/keys.ts).
const adminRole = defaultAc.newRole({
  user: ['create', 'list', 'delete', 'get', 'update', 'set-email'],
  session: ['list', 'revoke', 'delete'],
})

export const auth = betterAuth({
  appName: 'Avnac',
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: corsOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created by an admin (/auth/admin/create-user).
    disableSignUp: true,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user: { id } }) => {
      // Without a reset slot the data key stays locked with the old password: what it encrypted
      // is unreadable, so drop it and let the user start fresh.
      const [key] = await db
        .select({ resetWrapped: userKey.resetWrapped })
        .from(userKey)
        .where(eq(userKey.userId, id))
      if (key && !key.resetWrapped) {
        await db
          .delete(document)
          .where(and(eq(document.ownerUserId, id), isNotNull(document.encrypted)))
        await db.delete(userKey).where(eq(userKey.userId, id))
      }
    },
  },
  plugins: [admin({ roles: { admin: adminRole, user: userAc } })],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
})

export async function requireUser(request: Request) {
  const authSession = await auth.api.getSession({ headers: request.headers })
  if (!authSession) {
    throw new HttpError(401, 'Authentication required')
  }
  return authSession.user
}

export async function requireAdmin(request: Request) {
  const sessionUser = await requireUser(request)
  if (sessionUser.role !== 'admin') {
    throw new HttpError(403, 'Admins only')
  }
  return sessionUser
}

/** Makes ADMIN_EMAIL an admin, creating the account with ADMIN_PASSWORD if needed. */
export async function ensureAdmin(): Promise<void> {
  const email = env.ADMIN_EMAIL
  if (!email) return
  const [existing] = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, email))
  if (existing) {
    if (existing.role !== 'admin') {
      await db.update(user).set({ role: 'admin' }).where(eq(user.id, existing.id))
    }
    return
  }
  if (!env.ADMIN_PASSWORD) {
    console.warn(`[avnac] ${email} does not exist yet: set ADMIN_PASSWORD to create it.`)
    return
  }
  await auth.api.createUser({
    body: {
      email,
      password: env.ADMIN_PASSWORD,
      name: email.split('@')[0] || email,
      role: 'admin',
    },
  })
  console.log(`[avnac] created admin account ${email}`)
}
