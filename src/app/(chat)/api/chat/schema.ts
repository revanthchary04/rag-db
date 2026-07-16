import { z } from 'zod'

const textPartSchema = z.object({
  type: z.enum(['text']),
  text: z.string().min(1).max(20000),
})

const partSchema = z.union([textPartSchema, z.object({ type: z.string() }).passthrough()])

export const postRequestBodySchema = z.object({
  id: z.string(),
  message: z.object({
    id: z.string(),
    role: z.enum(['user']),
    parts: z.array(partSchema),
  }),
  // RAG retrieval strategy (vector | hybrid | rerank | multi-query). Sent as the
  // template's "selectedChatModel" slot; may be absent.
  selectedChatModel: z.string().optional(),
  selectedVisibilityType: z.enum(['public', 'private']).optional(),
  // Optional RAG knobs from the settings dialog.
  topK: z.number().int().positive().max(50).optional(),
  filters: z.record(z.unknown()).optional(),
})

export type PostRequestBody = z.infer<typeof postRequestBodySchema>
