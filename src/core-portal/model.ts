import { z } from 'zod';

const id = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Invalid database identifier',
  );
const optionalText = z.string().trim().max(500).nullable().optional();

export const CorePortalCommandSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('student.create'),
    admissionNumber: z.string().trim().max(80).optional(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    classId: id.nullable().optional(),
    guardianPhone: z.string().trim().max(30).nullable().optional(),
  }),
  z.object({
    operation: z.literal('student.update'),
    id,
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    classId: id.nullable().optional(),
    guardianPhone: z.string().trim().max(30).nullable().optional(),
    status: z.enum(['active', 'graduated', 'withdrawn', 'suspended', 'transferred']),
  }),
  z.object({ operation: z.literal('student.invite'), id, email: z.string().email() }),
  z.object({
    operation: z.literal('identifier.profile.upsert'),
    id: id.optional(),
    name: z.string().trim().min(2).max(100),
    classId: id,
    format: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .refine((value) => value.includes('{NUMBER}'), 'Format must contain {NUMBER}.'),
    nextNumber: z.number().int().positive(),
    padding: z.number().int().min(1).max(12),
  }),
  z.object({ operation: z.literal('identifier.profile.delete'), id }),
  z.object({
    operation: z.literal('identifier.settings.update'),
    kind: z.enum(['admission', 'guardian']),
    format: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .refine((value) => value.includes('{NUMBER}'), 'Format must contain {NUMBER}.'),
    nextNumber: z.number().int().positive(),
    padding: z.number().int().min(1).max(12),
  }),
  z.object({
    operation: z.literal('staff.create'),
    employeeNumber: z.string().trim().min(1).max(80),
    fullName: z.string().trim().min(2).max(200),
    email: z.string().email(),
    role: z.enum([
      'school_admin',
      'teacher',
      'bursar',
      'admissions_officer',
      'exam_officer',
      'registrar',
      'librarian',
    ]),
    teachingAssignments: z
      .array(z.object({ classId: id, subjectId: id }))
      .max(100)
      .optional(),
    classTeacherClassIds: z.array(id).max(30).optional(),
  }),
  z.object({ operation: z.literal('staff.deactivate'), id }),
  z.object({ operation: z.literal('staff.reactivate'), id }),
  z.object({
    operation: z.literal('membership.transition'),
    membershipId: id,
    status: z.enum(['active', 'suspended', 'revoked']),
    lifecycleState: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({ operation: z.literal('membership.role.assign'), membershipId: id, roleId: id }),
  z.object({ operation: z.literal('membership.role.revoke'), assignmentId: id }),
  z.object({
    operation: z.literal('attendance.record'),
    studentId: id,
    classId: id,
    termId: id,
    date: z.string().date(),
    status: z.enum(['present', 'absent', 'late', 'excused']),
    note: optionalText,
  }),
  z.object({
    operation: z.literal('attendance.capture'),
    classId: id,
    termId: id,
    date: z.string().date(),
    entries: z
      .array(
        z.object({
          studentId: id,
          status: z.enum(['present', 'absent', 'late', 'excused']),
          note: z.string().trim().max(500).nullable().optional(),
        }),
      )
      .min(1)
      .max(250),
  }),
  z.object({
    operation: z.literal('attendance.correct'),
    attendanceId: id,
    status: z.enum(['present', 'absent', 'late', 'excused']),
    note: z.string().trim().max(500).nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    operation: z.literal('assessment.create'),
    termId: id,
    classId: id,
    subjectId: id,
    name: z.string().trim().min(1).max(100),
    maximumScore: z.number().positive().max(1000),
    weightPercent: z.number().positive().max(100),
  }),
  z.object({
    operation: z.literal('result.record'),
    assessmentId: id,
    studentId: id,
    score: z.number().min(0).max(1000),
    remark: optionalText,
  }),
  z.object({
    operation: z.literal('result.report.ensure'),
    termId: id,
    classId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
  }),
  z.object({
    operation: z.literal('result.scores.bulk'),
    assessmentId: id,
    entries: z
      .array(z.object({ studentId: id, score: z.number().min(0).max(1000), remark: optionalText }))
      .min(1)
      .max(250),
  }),
  z
    .object({
      operation: z.literal('result.components.configure'),
      termId: id,
      classId: id,
      reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
      continuousAssessmentPercent: z.number().positive().max(99),
      examinationPercent: z.number().positive().max(99),
    })
    .refine((value) => value.continuousAssessmentPercent + value.examinationPercent === 100, {
      message: 'Continuous assessment and examination percentages must total 100.',
    }),
  z.object({
    operation: z.literal('result.subject-scores.bulk'),
    continuousAssessmentId: id,
    examinationId: id,
    entries: z
      .array(
        z.object({
          studentId: id,
          continuousAssessmentScore: z.number().min(0).max(100),
          examinationScore: z.number().min(0).max(100),
        }),
      )
      .min(1)
      .max(250),
  }),
  z.object({
    operation: z.literal('result.period-policy.configure'),
    termId: id,
    classId: id,
    midtermCaOnly: z.boolean(),
    continuousAssessmentPercent: z.number().positive().max(99),
    examinationPercent: z.number().positive().max(99),
  }),
  z.object({ operation: z.literal('result.midterm.import'), termId: id, classId: id }),
  z
    .object({
      operation: z.literal('result.session-weights.configure'),
      sessionId: id,
      classId: id,
      firstTermPercent: z.number().min(0).max(100),
      secondTermPercent: z.number().min(0).max(100),
      thirdTermPercent: z.number().min(0).max(100),
    })
    .refine(
      (value) =>
        Math.abs(value.firstTermPercent + value.secondTermPercent + value.thirdTermPercent - 100) <
        0.001,
      { message: 'The three term percentages must total 100.' },
    ),
  z.object({ operation: z.literal('result.session.build'), sessionId: id, classId: id }),
  z.object({
    operation: z.literal('result.summary.save'),
    termId: id,
    classId: id,
    studentId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
    teacherRemark: optionalText,
    principalRemark: optionalText,
    attendancePresent: z.number().int().min(0).nullable().optional(),
    attendanceTotal: z.number().int().min(0).nullable().optional(),
  }),
  z.object({
    operation: z.literal('result.summaries.bulk'),
    termId: id,
    classId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
    studentIds: z.array(id).min(1).max(250),
    teacherRemark: optionalText,
    principalRemark: optionalText,
  }),
  z.object({
    operation: z.literal('result.promotion-rule.save'),
    classId: id,
    reportType: z.enum(['end_of_term', 'end_of_session']),
    minimumAveragePercent: z.number().min(0).max(100).nullable(),
    subjectRequirements: z
      .array(z.object({ subjectId: id, minimumPercent: z.number().min(0).max(100) }))
      .max(30),
  }),
  z.object({
    operation: z.literal('result.submit'),
    termId: id,
    classId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    operation: z.literal('result.approve'),
    termId: id,
    classId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    operation: z.literal('result.reject'),
    termId: id,
    classId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
    note: z.string().trim().min(3).max(1000),
  }),
  z.object({
    operation: z.literal('result.release'),
    termId: id,
    classId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    operation: z.literal('result.reopen'),
    termId: id,
    classId: id,
    reportType: z.enum(['mid_term', 'end_of_term', 'end_of_session']),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    operation: z.literal('fee.create'),
    sessionId: id,
    termId: id.nullable().optional(),
    classId: id.nullable().optional(),
    classIds: z.array(id).max(100).default([]),
    studentAudience: z.enum(['all', 'new', 'returning']).default('all'),
    name: z.string().trim().min(1).max(120),
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({
    operation: z.literal('fee.update'),
    feeDefinitionId: id,
    sessionId: id,
    termId: id.nullable().optional(),
    classIds: z.array(id).max(100).default([]),
    studentAudience: z.enum(['all', 'new', 'returning']).default('all'),
    name: z.string().trim().min(1).max(120),
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({ operation: z.literal('fee.delete'), feeDefinitionId: id }),
  z.object({
    operation: z.literal('invoice.create'),
    studentId: id,
    feeDefinitionId: id,
    discountMinor: z.number().int().min(0).default(0),
    dueOn: z.string().date().nullable().optional(),
  }),
  z.object({
    operation: z.literal('invoice.bulk.create'),
    feeDefinitionId: id,
    dueOn: z.string().date().nullable().optional(),
  }),
  z.object({ operation: z.literal('invoice.claim'), studentId: id, feeDefinitionId: id }),
  z.object({
    operation: z.literal('payment.record'),
    studentId: id,
    invoiceId: id,
    amountMinor: z.number().int().positive(),
    providerReference: z.string().trim().min(8).max(160),
    paidAt: z.string().datetime(),
  }),
  z.object({
    operation: z.literal('invoice.adjust'),
    invoiceId: id,
    kind: z.enum(['credit', 'debit']),
    amountMinor: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
  }),
  z
    .object({
      operation: z.literal('payment.settings.update'),
      paystackEnabled: z.boolean(),
      manualTransferEnabled: z.boolean(),
      installmentsEnabled: z.boolean(),
      minimumInstallmentPercent: z.number().min(1).max(100),
      maximumInstallments: z.number().int().min(1).max(24),
      bankName: z.string().trim().max(120),
      accountName: z.string().trim().max(160),
      accountNumber: z.string().trim().max(40),
      transferInstructions: z.string().trim().max(1000),
    })
    .superRefine((value, context) => {
      if (value.installmentsEnabled && value.maximumInstallments < 2)
        context.addIssue({
          code: 'custom',
          message: 'Installment payments require at least two installments.',
        });
      if (
        value.manualTransferEnabled &&
        (value.bankName.length < 2 ||
          value.accountName.length < 2 ||
          value.accountNumber.length < 5)
      )
        context.addIssue({
          code: 'custom',
          message: 'Complete the bank details before enabling manual transfer.',
        });
    }),
]);

export type CorePortalCommand = z.infer<typeof CorePortalCommandSchema>;
export type CorePortalWorkspace = {
  students: Record<string, unknown>[];
  staff: Record<string, unknown>[];
  attendance: Record<string, unknown>[];
  assessments: Record<string, unknown>[];
  scores: Record<string, unknown>[];
  releases: Record<string, unknown>[];
  feeDefinitions: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  manualTransfers: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  resultWorkflows: Record<string, unknown>[];
  resultWorkflowEvents: Record<string, unknown>[];
  resultSummaries: Record<string, unknown>[];
  resultPromotionRules: Record<string, unknown>[];
  resultComponentSettings: Record<string, unknown>[];
  resultSessionWeightSettings: Record<string, unknown>[];
  resultScoreImports: Record<string, unknown>[];
  adjustments: Record<string, unknown>[];
  guardians: Record<string, unknown>[];
  guardianLinks: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
  memberships: Record<string, unknown>[];
  roles: Record<string, unknown>[];
  roleAssignments: Record<string, unknown>[];
  membershipEvents: Record<string, unknown>[];
  myClasses: Record<string, unknown>[];
  myClassAssignments: Record<string, unknown>[];
  mySubjectAssignments: Record<string, unknown>[];
  academicTerms: Record<string, unknown>[];
  academicSubjects: Record<string, unknown>[];
  attendanceCorrections: Record<string, unknown>[];
  parentLearningSummaries: Record<string, unknown>[];
  parentUpcomingWork: Record<string, unknown>[];
  parentOverdueWork: Record<string, unknown>[];
  parentAnnouncements: Record<string, unknown>[];
  parentApplications: Record<string, unknown>[];
  parentOffers: Record<string, unknown>[];
  studentEnrollments: Record<string, unknown>[];
  academicSessions: Record<string, unknown>[];
  studentClassSubjects: Record<string, unknown>[];
  identifierSettings: Record<string, unknown>[];
  identifierProfiles: Record<string, unknown>[];
  paymentSettings: Record<string, unknown> | null;
  payableFees: Record<string, unknown>[];
};
