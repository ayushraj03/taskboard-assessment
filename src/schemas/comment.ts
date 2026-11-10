import { z } from "zod";

// Only the body is accepted from the client. Author and timestamp are always
// set server-side, so unknown keys (authorId, createdAt, …) are stripped.
export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "comment cannot be empty").max(5000),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
