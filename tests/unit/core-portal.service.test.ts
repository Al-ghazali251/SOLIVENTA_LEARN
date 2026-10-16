import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../../src/config/bindings';
import { CorePortalService, type CorePortalGateway } from '../../src/services/core-portal.service';
import type { AuthContext } from '../../src/types/context';

const schoolId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const bindings = {} as Bindings;
const workspace = {
  students: [],
  staff: [],
  attendance: [],
  assessments: [],
  scores: [],
  releases: [],
  feeDefinitions: [],
  invoices: [],
  payments: [],
  manualTransfers: [],
  receipts: [],
  resultWorkflows: [],
  resultWorkflowEvents: [],
  adjustments: [],
  guardians: [],
  guardianLinks: [],
  accounts: [],
  memberships: [],
  roles: [],
  roleAssignments: [],
  membershipEvents: [],
  myClasses:[],myClassAssignments:[],mySubjectAssignments:[],academicTerms:[],academicSubjects:[],attendanceCorrections:[],parentLearningSummaries:[],parentUpcomingWork:[],parentOverdueWork:[],parentAnnouncements:[],parentApplications:[],parentOffers:[],studentEnrollments:[],academicSessions:[],studentClassSubjects:[],
};
function context(permissions: AuthContext['permissions']): AuthContext {
  return { userId, schoolId, roles: ['school_admin'], permissions, scope: { kind: 'school-wide' } };
}
function expectCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error('Expected action to fail.');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('core portal service', () => {
  it('loads only through a core-module permission and derives tenant from auth context', async () => {
    const loadWorkspace = vi.fn().mockResolvedValue(workspace);
    const gateway: CorePortalGateway = { workspace: loadWorkspace, execute: vi.fn() };
    const auth = context(new Set(['students.read']));
    await expect(new CorePortalService(gateway).workspace(bindings, auth)).resolves.toEqual(
      workspace,
    );
    expect(loadWorkspace).toHaveBeenCalledWith(bindings, auth);
    expectCode(
      () => new CorePortalService(gateway).workspace(bindings, context(new Set())),
      'PERMISSION_DENIED',
    );
  });

  it('allows a parent with linked-child read access to load the scoped workspace', async () => {
    const loadWorkspace = vi.fn().mockResolvedValue(workspace);
    const auth: AuthContext = { ...context(new Set(['children.read'])), roles: ['parent'], scope: { kind: 'linked-children' } };
    await expect(new CorePortalService({ workspace: loadWorkspace, execute: vi.fn() }).workspace(bindings, auth)).resolves.toEqual(workspace);
    expect(loadWorkspace).toHaveBeenCalledWith(bindings, auth);
  });

  it('uses operation-specific permissions and rejects role escalation', async () => {
    const execute = vi.fn().mockResolvedValue({ id: schoolId });
    const service = new CorePortalService({ workspace: vi.fn(), execute });
    const command = {
      operation: 'staff.create',
      employeeNumber: 'EMP-1',
      fullName: 'Ada Teacher',
      email: 'ada@example.test',
      role: 'teacher',
    } as const;
    expectCode(
      () => service.execute(bindings, context(new Set(['students.create'])), command),
      'PERMISSION_DENIED',
    );
    await expect(
      service.execute(bindings, context(new Set(['staff.manage'])), command),
    ).resolves.toEqual({ id: schoolId });
    expect(execute).toHaveBeenCalledWith(bindings, { schoolId, actorId: userId, command });
  });

  it('validates score and payment command inputs', () => {
    const service = new CorePortalService({ workspace: vi.fn(), execute: vi.fn() });
    expectCode(
      () =>
        service.execute(bindings, context(new Set(['results.record'])), {
          operation: 'result.record',
          assessmentId: schoolId,
          studentId: userId,
          score: -1,
        }),
      'BAD_REQUEST',
    );
    expectCode(
      () =>
        service.execute(bindings, context(new Set(['payments.verify'])), {
          operation: 'payment.record',
          studentId: schoolId,
          invoiceId: userId,
          amountMinor: 0,
          providerReference: 'short',
          paidAt: 'today',
        }),
      'BAD_REQUEST',
    );
  });
  it('separates membership lifecycle and role-management permissions', async () => {
    const execute=vi.fn().mockResolvedValue({id:schoolId});
    const service=new CorePortalService({workspace:vi.fn(),execute});
    const transition={operation:'membership.transition',membershipId:schoolId,status:'suspended',lifecycleState:'on_leave',reason:'Approved leave'} as const;
    expectCode(()=>service.execute(bindings,context(new Set(['staff.manage'])),transition),'PERMISSION_DENIED');
    await expect(service.execute(bindings,context(new Set(['membership.manage'])),transition)).resolves.toEqual({id:schoolId});
    const role={operation:'membership.role.assign',membershipId:schoolId,roleId:userId} as const;
    expectCode(()=>service.execute(bindings,context(new Set(['membership.manage'])),role),'PERMISSION_DENIED');
    await expect(service.execute(bindings,context(new Set(['roles.manage'])),role)).resolves.toEqual({id:schoolId});
  });
  it('separates teacher capture from administrative attendance correction', async()=>{
    const execute=vi.fn().mockResolvedValue({id:schoolId});const service=new CorePortalService({workspace:vi.fn(),execute});
    const correction={operation:'attendance.correct',attendanceId:schoolId,status:'late',reason:'Verified arrival time'} as const;
    expectCode(()=>service.execute(bindings,context(new Set(['attendance.record'])),correction),'PERMISSION_DENIED');
    await expect(service.execute(bindings,context(new Set(['attendance.manage'])),correction)).resolves.toEqual({id:schoolId});
  });
});
