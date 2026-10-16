import { z } from 'zod';

export const PROMPT_VERSION = 'lesson-note-v3';
// Private guidance is a separate field; every section is learner-facing.
export const GeneratedLessonSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    objectives: z.array(z.string().min(1).max(1000)).min(1).max(15),
    sections: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            type: z.enum(['paragraph', 'list']),
            heading: z.string().min(1).max(300),
            text: z.string().max(12000),
            items: z.array(z.string().max(2000)).max(30),
          })
          .strict(),
      )
      .min(4)
      .max(20),
    teacherNotes: z.string().min(1).max(10000),
  })
  .strict();

export function studentLessonContent(value: unknown) {
  const content = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    objectives: Array.isArray(content.objectives)
      ? content.objectives.filter((x) => typeof x === 'string')
      : [],
    sections: Array.isArray(content.sections)
      ? content.sections
          .filter((x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object')
          .filter((x: Record<string, unknown>) => !x.audience || x.audience === 'student')
          .map((x: Record<string, unknown>) => ({
            id: x.id,
            type: x.type,
            heading: x.heading,
            text: x.text,
            items: x.items,
          }))
      : [],
  };
}
