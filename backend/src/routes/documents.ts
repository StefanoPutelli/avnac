import { and, desc, eq, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { requireUser } from '../auth'
import { db } from '../db'
import { document } from '../db/schema'
import { documentPayloadSchema } from '../lib/editor-schema'
import { HttpError } from '../lib/http'

async function requireUserId(request: Request): Promise<string> {
  return (await requireUser(request)).id
}

function parseId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new HttpError(400, 'Invalid document id')
  }
  return id
}

export const documentsRoutes = new Elysia({ prefix: '/documents' })
  .get('/', async ({ request }) => {
    const userId = await requireUserId(request)
    const rows = await db
      .select({ id: document.id, updatedAt: document.updatedAt })
      .from(document)
      .where(eq(document.ownerUserId, userId))
      .orderBy(desc(document.updatedAt))

    return { data: rows.map(row => ({ ...row, updatedAt: row.updatedAt.getTime() })) }
  })
  .get('/:id', async ({ request, params }) => {
    const userId = await requireUserId(request)
    const row = await db.query.document.findFirst({
      where: and(eq(document.id, parseId(params.id)), eq(document.ownerUserId, userId)),
    })

    if (!row) {
      throw new HttpError(404, 'Document not found')
    }

    const updatedAt = row.updatedAt.getTime()
    return {
      data: row.encrypted
        ? { id: row.id, encrypted: row.encrypted, updatedAt }
        : // Legacy plaintext row: the owner's browser re-uploads it encrypted.
          {
            id: row.id,
            name: row.name,
            document: row.document,
            vectorBoards: row.vectorBoards,
            vectorBoardDocs: row.vectorBoardDocs,
            updatedAt,
          },
    }
  })
  .put('/:id', async ({ request, body, params, set }) => {
    const userId = await requireUserId(request)
    const id = parseId(params.id)
    const parsed = documentPayloadSchema.safeParse(body)
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid document payload', parsed.error.issues)
    }
    const { baseUpdatedAt, encrypted } = parsed.data
    const fields = {
      encrypted,
      name: null,
      document: null,
      vectorBoards: null,
      vectorBoardDocs: null,
    }

    const existing = await db.query.document.findFirst({
      where: eq(document.id, id),
      columns: { ownerUserId: true, updatedAt: true },
    })

    if (existing && existing.ownerUserId !== userId) {
      throw new HttpError(403, 'This document belongs to another user')
    }

    const now = new Date()
    // Optimistic concurrency: only overwrite the version the client last synced.
    const [row] = existing
      ? await db
          .update(document)
          .set({ ...fields, updatedAt: now })
          .where(
            and(
              eq(document.id, id),
              // Clients see ms timestamps; rows written outside the app may carry microseconds.
              sql`date_trunc('milliseconds', ${document.updatedAt}) = ${new Date(baseUpdatedAt ?? 0).toISOString()}::timestamptz`,
            ),
          )
          .returning({ updatedAt: document.updatedAt })
      : await db
          .insert(document)
          .values({ id, ownerUserId: userId, ...fields, createdAt: now, updatedAt: now })
          .onConflictDoNothing()
          .returning({ updatedAt: document.updatedAt })

    if (!row) {
      throw new HttpError(409, 'Document changed on the server')
    }

    set.status = existing ? 200 : 201
    return { data: { id, updatedAt: row.updatedAt.getTime() } }
  })
  .delete('/:id', async ({ request, params }) => {
    const userId = await requireUserId(request)
    const [row] = await db
      .delete(document)
      .where(and(eq(document.id, parseId(params.id)), eq(document.ownerUserId, userId)))
      .returning({ id: document.id })

    if (!row) {
      throw new HttpError(404, 'Document not found')
    }

    return { data: row }
  })
