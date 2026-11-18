import { randomBytes } from 'node:crypto'
import { and, eq, isNotNull, isNull, like } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { auth, requireAdmin, requireUser } from '../auth'
import { db } from '../db'
import { adminKey, user, userKey, verification } from '../db/schema'
import { HttpError } from '../lib/http'

// Stores only locked (wrapped) keys; every key is generated and opened in the browser
// (frontend/src/lib/avnac-crypto.ts).

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000
const blob = t.String({ minLength: 1, maxLength: 4096 })

export const keysRoutes = new Elysia({ prefix: '/keys' })
  .get('/me', async ({ request }) => {
    const { id } = await requireUser(request)
    const [row] = await db
      .select({
        salt: userKey.salt,
        iterations: userKey.iterations,
        passwordWrapped: userKey.passwordWrapped,
        adminWrapped: userKey.adminWrapped,
        resetWrapped: userKey.resetWrapped,
      })
      .from(userKey)
      .where(eq(userKey.userId, id))
    return { data: row ?? null }
  })
  .put(
    '/me',
    async ({ request, body }) => {
      const { id } = await requireUser(request)
      const values = { ...body, resetWrapped: null, updatedAt: new Date() }
      // Only the first setup, or finishing a reset link, may replace the password slot:
      // a stolen session must not be able to lock the owner out of their data.
      const [row] = await db
        .insert(userKey)
        .values({ userId: id, ...values })
        .onConflictDoUpdate({
          target: userKey.userId,
          set: values,
          setWhere: isNotNull(userKey.resetWrapped),
        })
        .returning({ userId: userKey.userId })
      if (!row) {
        throw new HttpError(409, 'Your key is already set up')
      }
      return { data: { ok: true } }
    },
    {
      body: t.Object({
        salt: blob,
        iterations: t.Integer({ minimum: 100_000 }),
        passwordWrapped: blob,
        adminWrapped: t.Nullable(blob),
      }),
    },
  )
  .put(
    '/me/admin-wrapped',
    async ({ request, body }) => {
      const { id } = await requireUser(request)
      const [row] = await db
        .update(userKey)
        .set({ adminWrapped: body.adminWrapped })
        .where(and(eq(userKey.userId, id), isNull(userKey.adminWrapped)))
        .returning({ userId: userKey.userId })
      if (!row) {
        throw new HttpError(409, 'Admin recovery is already set up')
      }
      return { data: { ok: true } }
    },
    { body: t.Object({ adminWrapped: blob }) },
  )
  .get('/admin', async ({ request }) => {
    const sessionUser = await requireUser(request)
    const [row] = await db.select().from(adminKey).where(eq(adminKey.id, 1))
    if (!row) return { data: null }
    return {
      data: {
        publicKey: row.publicKey,
        privateWrapped: sessionUser.role === 'admin' ? row.privateWrapped : null,
      },
    }
  })
  .put(
    '/admin',
    async ({ request, body }) => {
      const { id } = await requireAdmin(request)
      // ponytail: one admin key pair; a different ADMIN_EMAIL later can't open it and its
      // reset links fall back to "files can't be recovered".
      const [row] = await db
        .insert(adminKey)
        .values({ id: 1, userId: id, ...body })
        .onConflictDoNothing()
        .returning({ id: adminKey.id })
      if (!row) {
        throw new HttpError(409, 'The admin key already exists')
      }
      return { data: { ok: true } }
    },
    {
      body: t.Object({
        publicKey: t.String({ minLength: 1, maxLength: 8192 }),
        privateWrapped: t.String({ minLength: 1, maxLength: 8192 }),
      }),
    },
  )
  .get('/users/:id', async ({ request, params }) => {
    await requireAdmin(request)
    const [row] = await db
      .select({ adminWrapped: userKey.adminWrapped })
      .from(userKey)
      .where(eq(userKey.userId, params.id))
    return { data: { hasKey: Boolean(row), adminWrapped: row?.adminWrapped ?? null } }
  })
  .post(
    '/users/:id/link',
    async ({ request, params, body }) => {
      await requireAdmin(request)
      const [target] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, params.id))
      if (!target) {
        throw new HttpError(404, 'User not found')
      }

      // One live link per user: older links stop working.
      await db
        .delete(verification)
        .where(
          and(eq(verification.value, params.id), like(verification.identifier, 'reset-password:%')),
        )
      await db
        .update(userKey)
        .set({ resetWrapped: body.resetWrapped })
        .where(eq(userKey.userId, params.id))

      // Same token format as Better Auth's own reset flow, so /auth/reset-password consumes it.
      const token = randomBytes(24).toString('base64url')
      const ctx = await auth.$context
      await ctx.internalAdapter.createVerificationValue({
        identifier: `reset-password:${token}`,
        value: params.id,
        expiresAt: new Date(Date.now() + LINK_TTL_MS),
      })

      const query = new URLSearchParams({ token, email: target.email })
      return { data: { path: `/invite?${query}` } }
    },
    { body: t.Object({ resetWrapped: t.Nullable(blob) }) },
  )
