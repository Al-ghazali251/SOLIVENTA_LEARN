import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import {
  CorePortalCommandSchema,
  type CorePortalCommand,
  type CorePortalWorkspace,
} from '../core-portal/model';
import { assertPermission, assertSchoolScope } from '../permissions/authorize';
import type { Permission } from '../permissions/permissions';
import type { AuthContext } from '../types/context';

export interface CorePortalGateway {
  workspace(bindings: Bindings, context: AuthContext): Promise<CorePortalWorkspace>;
  execute(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; command: CorePortalCommand },
  ): Promise<Record<string, unknown>>;
}

const permissionByOperation: Readonly<Record<CorePortalCommand['operation'], Permission>> = {
  'student.create': 'students.create',
  'identifier.settings.update': 'students.create',
  'identifier.profile.upsert': 'students.create',
  'identifier.profile.delete': 'students.create',
  'student.update': 'students.update',
  'student.invite': 'membership.manage',
  'staff.create': 'staff.manage',
  'staff.deactivate': 'staff.manage',
  'staff.reactivate': 'staff.manage',
  'membership.transition': 'membership.manage',
  'membership.role.assign': 'roles.manage',
  'membership.role.revoke': 'roles.manage',
  'attendance.record': 'attendance.record',
  'attendance.capture': 'attendance.record',
  'attendance.correct': 'attendance.manage',
  'assessment.create': 'results.record',
  'result.record': 'results.record',
  'result.report.ensure': 'results.record',
  'result.scores.bulk': 'results.record',
  'result.components.configure': 'results.record',
  'result.subject-scores.bulk': 'results.record',
  'result.period-policy.configure': 'results.record',
  'result.midterm.import': 'results.record',
  'result.session-weights.configure': 'results.release',
  'result.session.build': 'results.release',
  'result.summary.save': 'results.record',
  'result.summaries.bulk': 'results.record',
  'result.promotion-rule.save': 'students.promote',
  'result.submit': 'results.record',
  'result.approve': 'results.release',
  'result.reject': 'results.release',
  'result.release': 'results.release',
  'result.reopen': 'results.release',
  'fee.create': 'fees.manage',
  'fee.update': 'fees.manage',
  'fee.delete': 'fees.manage',
  'invoice.create': 'fees.manage',
  'invoice.bulk.create': 'fees.manage',
  'invoice.claim': 'fees.read',
  'payment.record': 'payments.verify',
  'invoice.adjust': 'fees.manage',
  'payment.settings.update': 'fees.manage',
};

export class CorePortalService {
  constructor(private readonly gateway: CorePortalGateway) {}

  workspace(bindings: Bindings, context: AuthContext) {
    assertSchoolScope(context, context.schoolId);
    if (
      ![
        'students.read',
        'self.read',
        'children.read',
        'staff.manage',
        'membership.manage',
        'roles.read',
        'attendance.record',
        'attendance.manage',
        'results.read',
        'fees.read',
      ].some((permission) => context.permissions.has(permission as Permission))
    )
      throw new AppError({ code: 'PERMISSION_DENIED', message: 'Permission denied.', status: 403 });
    return this.gateway.workspace(bindings, context);
  }

  execute(bindings: Bindings, context: AuthContext, value: unknown) {
    assertSchoolScope(context, context.schoolId);
    const parsed = CorePortalCommandSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Core portal command validation failed.',
        status: 400,
        details: { issues: parsed.error.issues },
      });
    assertPermission(context, permissionByOperation[parsed.data.operation]);
    return this.gateway.execute(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      command: parsed.data,
    });
  }
}
