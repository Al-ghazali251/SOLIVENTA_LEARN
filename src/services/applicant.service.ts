import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import { ApplicantCommandSchema, type ApplicantCommand, type ApplicantWorkspace } from '../applicant/model';
import { assertSchoolScope } from '../permissions/authorize';
import type { AuthContext } from '../types/context';

export interface ApplicantGateway {
  workspace(bindings: Bindings, input: { schoolId: string; accountId: string }): Promise<ApplicantWorkspace>;
  execute(bindings: Bindings, input: { schoolId: string; accountId: string; command: ApplicantCommand }): Promise<Record<string, unknown>>;
}

export class ApplicantService {
  constructor(private readonly gateway: ApplicantGateway) {}
  private authorize(context: AuthContext) {
    assertSchoolScope(context, context.schoolId);
    if (!context.permissions.has('applicant.self.read') || context.scope.kind !== 'self')
      throw new AppError({ code: 'PERMISSION_DENIED', message: 'Applicant access is required.', status: 403 });
  }
  workspace(bindings: Bindings, context: AuthContext) {
    this.authorize(context);
    return this.gateway.workspace(bindings, { schoolId: context.schoolId, accountId: context.userId });
  }
  execute(bindings: Bindings, context: AuthContext, value: unknown) {
    this.authorize(context);
    const parsed = ApplicantCommandSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError({ code: 'BAD_REQUEST', message: 'Applicant command validation failed.', status: 400, details: { issues: parsed.error.issues } });
    return this.gateway.execute(bindings, { schoolId: context.schoolId, accountId: context.userId, command: parsed.data });
  }
}
