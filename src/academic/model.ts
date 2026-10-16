import { z } from 'zod';
const id=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'Invalid database identifier');

export const AcademicStatusSchema = z.enum(['planned', 'active', 'closed']);
export const AcademicEntitySchema = z.enum(['class', 'arm', 'subject', 'session', 'term', 'template']);
export const AcademicRecordInputSchema = z.discriminatedUnion('entity', [
  z.object({
    entity: z.literal('template'), id: id.optional(), name: z.string().trim().min(2).max(100),
    classId: id.nullable().default(null), armId: id.nullable().default(null),
    subjects: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    active: z.boolean().default(true),
  }),
  z.object({
    entity: z.literal('arm'), id: id.optional(), classId: id,
    name: z.string().trim().min(1).max(60),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),
    capacity: z.number().int().positive().nullable().default(null), active: z.boolean().default(true),
  }),
  z.object({
    entity: z.literal('class'),
    id: id.optional(),
    name: z.string().trim().min(1).max(80),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,30}$/),
    active: z.boolean().default(true),
  }),
  z.object({
    entity: z.literal('subject'),
    id: id.optional(),
    name: z.string().trim().min(1).max(100),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,30}$/),
    active: z.boolean().default(true),
  }),
  z
    .object({
      entity: z.literal('session'),
      id: id.optional(),
      name: z.string().trim().min(3).max(40),
      startsOn: z.string().date().nullable().default(null),
      endsOn: z.string().date().nullable().default(null),
      status: AcademicStatusSchema,
    })
    .refine((value) => !value.startsOn || !value.endsOn || value.startsOn < value.endsOn, {
      message: 'Session end date must follow its start date.',
      path: ['endsOn'],
    }),
  z
    .object({
      entity: z.literal('term'),
      id: id.optional(),
      sessionId: id,
      name: z.string().trim().min(2).max(40),
      position: z.number().int().min(1).max(6),
      startsOn: z.string().date().nullable().default(null),
      endsOn: z.string().date().nullable().default(null),
      status: AcademicStatusSchema,
    })
    .refine((value) => !value.startsOn || !value.endsOn || value.startsOn < value.endsOn, {
      message: 'Term end date must follow its start date.',
      path: ['endsOn'],
    }),
]);

export type AcademicRecordInput = z.infer<typeof AcademicRecordInputSchema>;
export type AcademicWorkspace = Readonly<{
  classes: readonly Record<string, unknown>[];
  arms: readonly Record<string, unknown>[];
  subjects: readonly Record<string, unknown>[];
  sessions: readonly Record<string, unknown>[];
  terms: readonly Record<string, unknown>[];
  classSubjects: readonly Record<string, unknown>[];
  classTeachers: readonly Record<string, unknown>[];
  teacherAssignments: readonly Record<string, unknown>[];
  students: readonly Record<string, unknown>[];
  staff: readonly Record<string, unknown>[];
  enrollments: readonly Record<string, unknown>[];
  templates: readonly Record<string, unknown>[];
}>;
