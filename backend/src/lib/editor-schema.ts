import { z } from 'zod'

// The server only ever sees ciphertext: the browser encrypts name, document and vector
// boards with the owner's data key (frontend/src/lib/avnac-crypto.ts).
export const documentPayloadSchema = z.object({
  encrypted: z.string().min(1),
  /** Server `updatedAt` (ms) the client last synced; null for a document it has never uploaded. */
  baseUpdatedAt: z.number().nullable().default(null),
})

export type DocumentPayload = z.infer<typeof documentPayloadSchema>
