import { z } from 'zod';
const id=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'Invalid database identifier');

export const ApplicantStatusSchema = z.enum([
  'draft', 'submitted', 'under_review', 'needs_information', 'waitlisted',
  'offer_issued', 'offer_accepted', 'offer_declined', 'accepted', 'rejected', 'converted',
]);

export const ApplicantCommandSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('profile.update'),
    phone: z.string().trim().max(30).nullable(),
    residentialAddress: z.string().trim().max(500).nullable(),
  }),
  z.object({
    operation: z.literal('guardian.upsert'),
    id: id.optional(),
    fullName: z.string().trim().min(2).max(160),
    relationship: z.string().trim().min(2).max(60),
    email: z.string().email().nullable(),
    phone: z.string().trim().max(30).nullable(),
    isPrimary: z.boolean(),
    canReceiveUpdates: z.boolean(),
  }),
  z.object({
    operation: z.literal('document.upload'),
    documentType: z.enum(['student_photo', 'birth_certificate', 'previous_class_result', 'other']),
    name: z.string().trim().min(1).max(180),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    base64: z.string().max(7_000_000),
  }),
  z.object({ operation: z.literal('offer.respond'), response: z.enum(['accept', 'decline']), note: z.string().trim().max(1000).optional() }),
  z.object({ operation:z.literal('entrance.attempt.start'), assignmentId:id }),
  z.object({ operation:z.literal('entrance.answer.save'), attemptId:id, questionId:id, answer:z.unknown() }),
  z.object({ operation:z.literal('entrance.integrity.signal'), attemptId:id, signalType:z.enum(['tab_hidden','window_blur','fullscreen_exit','copy','paste','network_offline','clock_drift','multiple_session','other']), severity:z.enum(['info','warning','critical']), clientOccurredAt:z.string().datetime(), metadata:z.record(z.string(),z.unknown()).default({}) }),
  z.object({ operation:z.literal('entrance.attempt.submit'), attemptId:id }),
]);

export type ApplicantCommand = z.infer<typeof ApplicantCommandSchema>;
export type ApplicantWorkspace = Readonly<{
  application: {
    id: string;
    applicationNumber: string;
    applicantName: string;
    email: string | null;
    phone: string | null;
    entryYear: string | null;
    status: z.infer<typeof ApplicantStatusSchema>;
    submittedAt: string | null;
    updatedAt: string;
    formData: Record<string, unknown>;
  };
  guardians: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  statusHistory: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  offers: Record<string, unknown>[];
  nextActions: { code: string; label: string; description: string }[];
  entranceAssignments: Record<string, unknown>[];
  entranceQuestions: Record<string, unknown>[];
  entranceAttempts: Record<string, unknown>[];
  entranceAnswers: Record<string, unknown>[];
}>; 
