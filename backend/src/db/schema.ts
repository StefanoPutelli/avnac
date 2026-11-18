import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull(),
    image: text('image'),
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  table => [uniqueIndex('user_email_unique').on(table.email)],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    impersonatedBy: text('impersonated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  table => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  table => [
    uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId),
    index('account_user_id_idx').on(table.userId),
  ],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  table => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_value_idx').on(table.value),
  ],
)

export const document = pgTable(
  'document',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    /** base64(iv ‖ AES-GCM) of {name, document, vectorBoards, vectorBoardDocs}, encrypted in the browser. */
    encrypted: text('encrypted'),
    // Legacy plaintext columns, nulled once the row is re-uploaded encrypted.
    name: text('name').default('Untitled'),
    document: jsonb('document'),
    vectorBoards: jsonb('vector_boards'),
    vectorBoardDocs: jsonb('vector_board_docs'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [index('document_owner_user_id_idx').on(table.ownerUserId)],
)

export const userKey = pgTable('user_key', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  salt: text('salt').notNull(),
  iterations: integer('iterations').notNull(),
  passwordWrapped: text('password_wrapped').notNull(),
  adminWrapped: text('admin_wrapped'),
  resetWrapped: text('reset_wrapped'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const adminKey = pgTable('admin_key', {
  id: integer('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(),
  privateWrapped: text('private_wrapped').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const schema = {
  user,
  session,
  account,
  verification,
  document,
  userKey,
  adminKey,
}

export type AppSchema = typeof schema
