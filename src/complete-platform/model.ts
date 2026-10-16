import { z } from 'zod';
const id = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Invalid database identifier',
  );
const LessonSectionSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(['heading', 'paragraph', 'list', 'quote', 'callout']),
  heading: z.string().max(300).optional(),
  text: z.string().max(20000).optional(),
  items: z.array(z.string().max(2000)).max(100).optional(),
});
const LessonContentSchema = z.object({
  objectives: z.array(z.string().max(1000)).max(30).default([]),
  sections: z.array(LessonSectionSchema).max(100),
  teacherNotes: z.string().max(10000).optional(),
});
export const CompletePlatformCommandSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('admission.create'),
    applicationNumber: z.string().trim().min(1).max(80),
    applicantName: z.string().trim().min(2).max(200),
    email: z.string().email().nullable().optional(),
    phone: z.string().max(30).nullable().optional(),
    desiredClassId: id.nullable().optional(),
  }),
  z.object({
    operation: z.literal('admission.review'),
    id,
    status: z.enum(['under_review', 'needs_information', 'waitlisted', 'accepted', 'rejected']),
    reason: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({
    operation: z.literal('admission.offer.issue'),
    applicationId: id,
    offerNumber: z.string().trim().min(1).max(80),
    classId: id.nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    conditions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  }),
  z.object({
    operation: z.literal('admission.payment.verify-bank'),
    id,
    status: z.enum(['successful', 'rejected']),
  }),
  z.object({
    operation: z.literal('admission.convert'),
    id,
    admissionNumber: z.string().trim().max(80).optional(),
    classId: id.nullable().optional(),
    sessionId: id,
  }),
  z.object({
    operation: z.literal('parent.link'),
    guardianId: id,
    studentId: id,
    relationship: z.string().trim().min(2).max(60),
  }),
  z.object({
    operation: z.literal('parent.unlink'),
    guardianId: id,
    studentId: id,
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    operation: z.literal('parent.invite'),
    studentId: id,
    email: z.string().email(),
    displayName: z.string().trim().min(2).max(200),
    relationship: z.string().trim().min(2).max(60),
  }),
  z.object({
    operation: z.literal('conversation.create'),
    subject: z.string().trim().min(1).max(200),
    participantUserIds: z.array(id).min(1).max(100),
    body: z.string().trim().min(1).max(5000),
  }),
  z.object({
    operation: z.literal('message.send'),
    conversationId: id,
    body: z.string().trim().min(1).max(5000),
  }),
  z.object({ operation: z.literal('message.read'), conversationId: id }),
  z.object({
    operation: z.literal('exam.create'),
    termId: id,
    classId: id,
    subjectId: id,
    title: z.string().trim().min(1).max(200),
    durationMinutes: z.number().int().min(1).max(600),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  }),
  z.object({
    operation: z.literal('exam.question.create'),
    examId: id,
    position: z.number().int().min(0),
    kind: z.enum(['objective', 'text']),
    prompt: z.string().trim().min(1).max(5000),
    options: z.array(z.string().max(1000)).max(20).nullable().optional(),
    correctAnswer: z.unknown().optional(),
    marks: z.number().positive().max(1000),
  }),
  z.object({
    operation: z.literal('exam.status'),
    id,
    status: z.enum(['scheduled', 'active', 'closed', 'graded', 'released']),
  }),
  z.object({ operation: z.literal('exam.attempt.start'), examId: id, studentId: id }),
  z.object({
    operation: z.literal('exam.answer.save'),
    attemptId: id,
    questionId: id,
    answer: z.unknown(),
  }),
  z.object({ operation: z.literal('exam.attempt.submit'), attemptId: id }),
  z.object({
    operation: z.literal('entrance.exam.create'),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).optional(),
    durationMinutes: z.number().int().min(1).max(600),
    passMark: z.number().min(0).max(100),
  }),
  z.object({
    operation: z.literal('entrance.exam.import'),
    examId: id,
    format: z.enum(['markdown', 'yaml']),
    source: z.string().min(1).max(500000),
  }),
  z.object({
    operation: z.literal('entrance.question.create'),
    versionId: id,
    kind: z.enum([
      'single_choice',
      'multiple_choice',
      'true_false',
      'short_text',
      'long_text',
      'number',
    ]),
    prompt: z.string().trim().min(1).max(10000),
    options: z.array(z.string().min(1).max(2000)).max(20).optional(),
    correctAnswer: z.unknown().optional(),
    marks: z.number().positive().max(1000),
    explanation: z.string().max(5000).optional(),
  }),
  z.object({ operation: z.literal('entrance.exam.publish'), versionId: id }),
  z.object({
    operation: z.literal('entrance.exam.schedule'),
    versionId: id,
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime(),
    maxAttempts: z.number().int().min(1).max(10).default(1),
  }),
  z.object({ operation: z.literal('entrance.exam.assign'), scheduleId: id, applicationId: id }),
  z.object({
    operation: z.literal('entrance.exam.accommodate'),
    assignmentId: id,
    extraTimeMinutes: z.number().int().min(0).max(600),
    additionalAttempts: z.number().int().min(0).max(10),
    readAloud: z.boolean().default(false),
    reducedMotion: z.boolean().default(false),
    note: z.string().max(1000).optional(),
  }),
  z.object({
    operation: z.literal('entrance.attempt.review'),
    attemptId: id,
    decision: z.enum(['reviewed', 'invalidated']),
    score: z.number().min(0).optional(),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    operation: z.literal('lesson.create'),
    classId: id,
    subjectId: id,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2000).nullable().optional(),
  }),
  z.object({ operation: z.literal('curriculum.list'), classroomId: id }),
  z.object({
    operation: z.literal('curriculum.create'),
    classroomId: id,
    curriculum: z.string().trim().min(1).max(150),
    version: z.string().trim().min(1).max(80),
    term: z.string().trim().min(1).max(80),
    week: z.number().int().min(1).max(53),
    topic: z.string().trim().min(1).max(200),
    objectives: z.array(z.string().trim().min(1).max(1000)).min(1).max(15),
    sourceExcerpt: z.string().trim().min(50).max(24000),
    sourceReference: z.string().trim().min(1).max(1000),
  }),
  z.object({
    operation: z.literal('lesson.generate'),
    classroomId: id,
    topicId: id,
    requestKey: z.string().uuid(),
    language: z.string().trim().min(1).max(80).default('English'),
    duration: z.number().int().min(10).max(180).default(40),
  }),
  z.object({ operation: z.literal('lesson.generation.status'), id }),
  z.object({ operation: z.literal('lesson.publish'), id }),
  z.object({
    operation: z.literal('lesson.save'),
    id: id.optional(),
    classroomId: id,
    kind: z.enum(['plan', 'note']),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2000).nullable().optional(),
    content: LessonContentSchema,
  }),
  z.object({
    operation: z.literal('lesson.submit'),
    id,
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    operation: z.literal('lesson.review'),
    id,
    decision: z.enum(['approve', 'request_changes']),
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    operation: z.literal('lesson.archive'),
    id,
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    operation: z.literal('lesson.resource.add'),
    lessonId: id,
    kind: z.enum(['link', 'document', 'video', 'image', 'audio', 'other']),
    title: z.string().trim().min(1).max(200),
    url: z.string().trim().url().max(2000),
    description: z.string().trim().max(2000).optional(),
  }),
  z.object({ operation: z.literal('lesson.resource.remove'), id }),
  z.object({ operation: z.literal('classroom.reconcile') }),
  z.object({
    operation: z.literal('stream.post.create'),
    classroomId: id,
    kind: z.enum(['announcement', 'discussion']),
    title: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1).max(10000),
  }),
  z.object({
    operation: z.literal('stream.post.moderate'),
    classroomId: id,
    postId: id,
    action: z.enum(['approve', 'hide', 'remove']),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    operation: z.literal('stream.comment.create'),
    postId: id,
    body: z.string().trim().min(1).max(5000),
  }),
  z.object({
    operation: z.literal('stream.comment.moderate'),
    postId: id,
    commentId: id,
    action: z.enum(['approve', 'hide', 'remove']),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    operation: z.literal('assignment.create'),
    classroomId: id.optional(),
    classId: id,
    subjectId: id,
    lessonId: id.nullable().optional(),
    title: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(10000),
    dueAt: z.string().datetime().nullable().optional(),
    maximumScore: z.number().positive().max(1000),
  }),
  z.object({ operation: z.literal('assignment.publish'), id }),
  z.object({
    operation: z.literal('assignment.transition'),
    id,
    action: z.enum(['publish', 'close', 'release']),
  }),
  z.object({
    operation: z.literal('assignment.extension.grant'),
    assignmentId: id,
    studentId: id,
    extendedDueAt: z.string().datetime(),
    reason: z.string().trim().min(3).max(1000),
  }),
  z.object({
    operation: z.literal('assignment.attachment.upload'),
    assignmentId: id.optional(),
    submissionId: id.optional(),
    clientRequestId: id.optional(),
    name: z.string().trim().min(1).max(255),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
    base64: z.string().min(1).max(30000000),
  }),
  z.object({
    operation: z.literal('assignment.submission.save'),
    assignmentId: id,
    studentId: id,
    response: z.record(z.string(), z.unknown()),
  }),
  z.object({ operation: z.literal('assignment.submission.submit'), id }),
  z.object({ operation: z.literal('assignment.submission.release'), id }),
  z.object({
    operation: z.literal('gradebook.item.create'),
    classroomId: id,
    title: z.string().trim().min(1).max(200),
    kind: z.enum(['assignment', 'quiz', 'participation', 'other']),
    maximumScore: z.number().positive().max(1000),
    weight: z.number().min(0).max(100),
  }),
  z.object({
    operation: z.literal('gradebook.grade.save'),
    gradeItemId: id,
    studentId: id,
    score: z.number().min(0).max(1000),
    feedback: z.string().max(5000).optional(),
  }),
  z.object({ operation: z.literal('gradebook.item.release'), id }),
  z.object({
    operation: z.literal('gradebook.export.formal'),
    gradeItemId: id,
    termId: id,
    weightPercent: z.number().positive().max(100),
  }),
  z.object({
    operation: z.literal('quiz.create'),
    classroomId: id,
    title: z.string().trim().min(1).max(200),
    instructions: z.string().max(5000).optional(),
    dueAt: z.string().datetime().optional(),
    attemptsAllowed: z.number().int().min(1).max(10),
  }),
  z.object({
    operation: z.literal('quiz.question.add'),
    quizId: id,
    kind: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_text']),
    prompt: z.string().trim().min(1).max(5000),
    options: z.array(z.string().max(1000)).max(20).optional(),
    correctAnswer: z.unknown(),
    marks: z.number().positive().max(100),
  }),
  z.object({ operation: z.literal('quiz.publish'), id }),
  z.object({ operation: z.literal('quiz.attempt.start'), quizId: id, studentId: id }),
  z.object({
    operation: z.literal('quiz.answer.save'),
    attemptId: id,
    questionId: id,
    answer: z.unknown(),
  }),
  z.object({ operation: z.literal('quiz.attempt.submit'), id }),
  z.object({ operation: z.literal('learning.download.prepare'), attachmentId: id }),
  z.object({
    operation: z.literal('assignment.submission.grade'),
    id,
    score: z.number().min(0).max(1000),
    feedback: z.string().max(5000).nullable().optional(),
  }),
  z.object({
    operation: z.literal('library.book.create'),
    accessionNumber: z.string().trim().min(1).max(80),
    isbn: z.string().trim().max(30).nullable().optional(),
    title: z.string().trim().min(1).max(300),
    author: z.string().trim().min(1).max(200),
    copies: z.number().int().min(1).max(10000),
  }),
  z.object({
    operation: z.literal('library.loan.create'),
    bookId: id,
    borrowerUserId: id,
    dueAt: z.string().datetime(),
  }),
  z.object({ operation: z.literal('library.loan.return'), id }),
  z.object({
    operation: z.literal('moderator.school.status'),
    schoolId: id,
    status: z.enum(['active', 'suspended']),
  }),
]);
export type CompletePlatformCommand = z.infer<typeof CompletePlatformCommandSchema>;
export type CompletePlatformWorkspace = Readonly<
  Record<
    | 'admissions'
    | 'admissionPayments'
    | 'admissionOffers'
    | 'guardians'
    | 'parentLinks'
    | 'conversations'
    | 'messages'
    | 'messageRecipients'
    | 'conversationParticipants'
    | 'libraryBorrowers'
    | 'exams'
    | 'examQuestions'
    | 'examAttempts'
    | 'lessons'
    | 'assignments'
    | 'assignmentSubmissions'
    | 'books'
    | 'loans'
    | 'auditEvents'
    | 'entranceExams'
    | 'entranceVersions'
    | 'entranceQuestions'
    | 'entranceSchedules'
    | 'entranceAssignments'
    | 'entranceAttempts'
    | 'entranceIntegritySignals'
    | 'entranceAccommodations'
    | 'classes'
    | 'academicSessions'
    | 'classrooms'
    | 'classroomMemberships'
    | 'lessonResources'
    | 'lessonRevisions'
    | 'lessonWorkflowEvents'
    | 'streamPosts'
    | 'streamComments'
    | 'assignmentExtensions'
    | 'assignmentAttachments'
    | 'assignmentEvents'
    | 'gradeItems'
    | 'classroomGrades'
    | 'quizzes'
    | 'quizQuestions'
    | 'quizAttempts'
    | 'quizAnswers'
    | 'formalGradeExports'
    | 'schools',
    Record<string, unknown>[]
  >
>;
