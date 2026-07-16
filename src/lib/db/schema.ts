import type { InferSelectModel } from 'drizzle-orm'
import {
  doublePrecision,
  integer,
  json,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * App-owned chat + auth tables, managed by Drizzle in the shared `ragdb`
 * Postgres. These live alongside the FastAPI-owned RAG tables (documents,
 * chunks, query_logs, eval_*) but are namespaced with PascalCase names to
 * avoid any collision. RAG retrieval/generation/observability stay in FastAPI;
 * these tables only persist the conversation surface.
 */

export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 }),
})

export type User = InferSelectModel<typeof user>

export const chat = pgTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
})

export type Chat = InferSelectModel<typeof chat>

/**
 * AI SDK v5 message shape (`parts` + `attachments`) extended with the RAG
 * observability columns previously carried by the FastAPI chat_messages table
 * (see PersistedChatMessage). Nothing from the old shape is lost.
 */
export const message = pgTable('Message_v2', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  parts: json('parts').notNull(),
  attachments: json('attachments').notNull(),
  createdAt: timestamp('createdAt').notNull(),
  // RAG / observability metadata (assistant messages)
  citations: jsonb('citations'),
  metadata: jsonb('metadata'),
  latencyMs: integer('latencyMs'),
  costUsd: doublePrecision('costUsd'),
  ragModel: text('ragModel'),
  requestId: text('requestId'),
  queryLogId: text('queryLogId'),
  evalRunId: text('evalRunId'),
  evalCaseId: text('evalCaseId'),
})

export type DBMessage = InferSelectModel<typeof message>
