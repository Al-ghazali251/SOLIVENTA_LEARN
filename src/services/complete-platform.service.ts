import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import {
  CompletePlatformCommandSchema,
  type CompletePlatformCommand,
  type CompletePlatformWorkspace,
} from '../complete-platform/model';
import { assertPermission, assertSchoolScope } from '../permissions/authorize';
import type { Permission } from '../permissions/permissions';
import type { AuthContext } from '../types/context';

export interface CompletePlatformGateway {
  submitContact(
    bindings: Bindings,
    input: { schoolId: string; name: string; email: string; message: string },
  ): Promise<{ accepted: true }>;
  submitAdmission(
    bindings: Bindings,
    input: {
      schoolId: string;
      applicantName: string;
      email: string;
      entryYear: string;
      phone?: string | undefined;
      formData?: Record<string, string> | undefined;
      documents?: { field: string; name: string; type: string; base64: string }[] | undefined;
    },
  ): Promise<{ applicationNumber: string; accessPin: string }>;
  initializeAdmissionPayment(
    bindings: Bindings,
    input: { schoolId: string; applicationNumber: string; accessPin: string; callbackUrl: string },
  ): Promise<{ authorizationUrl: string; reference: string }>;
  recordAdmissionBankTransfer(
    bindings: Bindings,
    input: {
      schoolId: string;
      applicationNumber: string;
      accessPin: string;
      transferReference: string;
    },
  ): Promise<{ status: 'pending_verification'; reference: string }>;
  verifyAdmissionPayment(
    bindings: Bindings,
    input: { schoolId: string; applicationNumber: string; accessPin: string; reference: string },
  ): Promise<{ status: string }>;
  verifyAdmissionPaymentByReference(
    bindings: Bindings,
    reference: string,
  ): Promise<{ status: string }>;
  getAdmissionStatus(
    bindings: Bindings,
    input: { schoolId: string; identifier: string; accessPin: string },
  ): Promise<{
    applicationNumber: string;
    applicantName: string;
    status: string;
    paymentStatus: string;
  }>;
  workspace(bindings: Bindings, context: AuthContext): Promise<CompletePlatformWorkspace>;
  execute(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      isModerator: boolean;
      scopeKind: AuthContext['scope']['kind'];
      command: CompletePlatformCommand;
    },
  ): Promise<Record<string, unknown>>;
}
const permissionByOperation: Record<CompletePlatformCommand['operation'], Permission> = {
  'admission.create': 'admissions.manage',
  'admission.review': 'admissions.manage',
  'admission.offer.issue': 'admissions.manage',
  'admission.payment.verify-bank': 'admissions.manage',
  'admission.convert': 'admissions.manage',
  'parent.link': 'parents.manage',
  'parent.unlink': 'parents.manage',
  'parent.invite': 'parents.manage',
  'conversation.create': 'messages.send',
  'message.send': 'messages.send',
  'message.read': 'messages.read',
  'exam.create': 'exams.manage',
  'exam.question.create': 'exams.manage',
  'exam.status': 'exams.manage',
  'exam.attempt.start': 'exams.read',
  'exam.answer.save': 'exams.read',
  'exam.attempt.submit': 'exams.read',
  'entrance.exam.create': 'exams.manage',
  'entrance.exam.import': 'exams.manage',
  'entrance.question.create': 'exams.manage',
  'entrance.exam.publish': 'exams.manage',
  'entrance.exam.schedule': 'exams.manage',
  'entrance.exam.assign': 'exams.manage',
  'entrance.exam.accommodate': 'exams.manage',
  'entrance.attempt.review': 'exams.manage',
  'curriculum.list': 'lessons.manage',
  'curriculum.create': 'academic.manage',
  'lesson.generate': 'lessons.manage',
  'lesson.generation.status': 'lessons.manage',
  'lesson.create': 'lessons.manage',
  'lesson.publish': 'lessons.manage',
  'lesson.save': 'lessons.manage',
  'lesson.submit': 'lessons.manage',
  'lesson.review': 'academic.manage',
  'lesson.archive': 'academic.manage',
  'lesson.resource.add': 'lessons.manage',
  'lesson.resource.remove': 'lessons.manage',
  'classroom.reconcile': 'academic.manage',
  'stream.post.create': 'messages.send',
  'stream.post.moderate': 'lessons.manage',
  'stream.comment.create': 'messages.send',
  'stream.comment.moderate': 'lessons.manage',
  'assignment.create': 'assignments.manage',
  'assignment.publish': 'assignments.manage',
  'assignment.transition': 'assignments.manage',
  'assignment.extension.grant': 'assignments.manage',
  'assignment.attachment.upload': 'assignments.read',
  'assignment.submission.save': 'assignments.read',
  'assignment.submission.submit': 'assignments.read',
  'assignment.submission.release': 'assignments.manage',
  'gradebook.item.create': 'assignments.manage',
  'gradebook.grade.save': 'assignments.manage',
  'gradebook.item.release': 'assignments.manage',
  'gradebook.export.formal': 'results.record',
  'quiz.create': 'assignments.manage',
  'quiz.question.add': 'assignments.manage',
  'quiz.publish': 'assignments.manage',
  'quiz.attempt.start': 'assignments.read',
  'quiz.answer.save': 'assignments.read',
  'quiz.attempt.submit': 'assignments.read',
  'learning.download.prepare': 'assignments.read',
  'assignment.submission.grade': 'assignments.manage',
  'library.book.create': 'library.manage',
  'library.loan.create': 'library.manage',
  'library.loan.return': 'library.manage',
  'moderator.school.status': 'platform.schools.manage',
};
const readPermissions: Permission[] = [
  'admissions.read',
  'parents.read',
  'messages.read',
  'exams.read',
  'assignments.read',
  'lessons.read',
  'library.read',
  'platform.schools.read',
  'audit.read',
];
export class CompletePlatformService {
  constructor(private readonly gateway: CompletePlatformGateway) {}
  workspace(bindings: Bindings, context: AuthContext) {
    assertSchoolScope(context, context.schoolId);
    if (!readPermissions.some((permission) => context.permissions.has(permission)))
      throw new AppError({ code: 'PERMISSION_DENIED', message: 'Permission denied.', status: 403 });
    return this.gateway.workspace(bindings, context);
  }
  execute(bindings: Bindings, context: AuthContext, value: unknown) {
    const parsed = CompletePlatformCommandSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Complete platform command validation failed.',
        status: 400,
        details: { issues: parsed.error.issues },
      });
    assertPermission(context, permissionByOperation[parsed.data.operation]);
    if (parsed.data.operation !== 'moderator.school.status')
      assertSchoolScope(context, context.schoolId);
    return this.gateway.execute(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      isModerator: context.roles.includes('moderator'),
      scopeKind: context.scope.kind,
      command: parsed.data,
    });
  }
}
