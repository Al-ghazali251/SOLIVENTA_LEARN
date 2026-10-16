import { describe, expect, it, vi } from 'vitest';
import {
  CompletePlatformService,
  type CompletePlatformGateway,
} from '../../src/services/complete-platform.service';
import type { AuthContext } from '../../src/types/context';
import type { Bindings } from '../../src/config/bindings';
import { CompletePlatformCommandSchema } from '../../src/complete-platform/model';
const bindings = {} as Bindings;
const empty = {
  admissions: [],
  guardians: [],
  parentLinks: [],
  conversations: [],
  messages: [],
  exams: [],
  lessons: [],
  classrooms:[],classroomMemberships:[],
  lessonResources:[],lessonRevisions:[],lessonWorkflowEvents:[],
  streamPosts:[],streamComments:[],assignmentExtensions:[],assignmentAttachments:[],assignmentEvents:[],
  gradeItems:[],classroomGrades:[],quizzes:[],quizQuestions:[],quizAttempts:[],quizAnswers:[],formalGradeExports:[],
  assignments: [],
  books: [],
  loans: [],
  schools: [],
};
const gateway: CompletePlatformGateway = {
  submitContact:vi.fn().mockResolvedValue({accepted:true}),
  submitAdmission: vi.fn().mockResolvedValue({ applicationNumber: 'WEB-1' }),
  initializeAdmissionPayment: vi.fn(),
  recordAdmissionBankTransfer: vi.fn(),
  verifyAdmissionPayment: vi.fn(),
  verifyAdmissionPaymentByReference: vi.fn(),
  getAdmissionStatus: vi.fn(),
  workspace: vi.fn().mockResolvedValue(empty),
  execute: vi.fn().mockResolvedValue({ id: 'saved' }),
};
const context = (permissions: string[], roles: string[] = ['school_admin']): AuthContext =>
  ({
    userId: '11111111-1111-4111-8111-111111111111',
    schoolId: '22222222-2222-4222-8222-222222222222',
    roles,
    permissions: new Set(permissions),
    scope: { kind: roles.includes('moderator') ? 'platform' : 'school-wide' },
  }) as AuthContext;
describe('complete platform authorization', () => {
  it('rejects a command without its explicit permission', () => {
    expect(() =>
      new CompletePlatformService(gateway).execute(bindings, context(['admissions.read']), {
        operation: 'admission.create',
        applicationNumber: 'A-1',
        applicantName: 'Ada Child',
      }),
    ).toThrow('permission');
  });
  it('validates command identifiers before reaching the gateway', () => {
    expect(() =>
      new CompletePlatformService(gateway).execute(bindings, context(['parents.manage']), {
        operation: 'parent.link',
        guardianId: 'wrong',
        studentId: 'wrong',
        relationship: 'Mother',
      }),
    ).toThrow('validation failed');
  });
  it('allows only a moderator permission to change school status', async () => {
    await expect(
      new CompletePlatformService(gateway).execute(
        bindings,
        context(['platform.schools.manage'], ['moderator']),
        {
          operation: 'moderator.school.status',
          schoolId: '33333333-3333-4333-8333-333333333333',
          status: 'suspended',
        },
      ),
    ).resolves.toEqual({ id: 'saved' });
  });
  it('requires admissions management permission to issue an offer', () => {
    expect(() =>
      new CompletePlatformService(gateway).execute(bindings, context(['admissions.read']), {
        operation: 'admission.offer.issue',
        applicationId: '33333333-3333-4333-8333-333333333333',
        offerNumber: 'OFF-2027-1',
        conditions: [],
      }),
    ).toThrow('permission');
  });
  it('requires an academic session for applicant conversion', () => {
    expect(CompletePlatformCommandSchema.safeParse({
      operation: 'admission.convert',
      id: '33333333-3333-4333-8333-333333333333',
      admissionNumber: 'STU-2027-1',
    }).success).toBe(false);
    expect(CompletePlatformCommandSchema.safeParse({
      operation: 'admission.convert',
      id: '33333333-3333-4333-8333-333333333333',
      admissionNumber: 'STU-2027-1',
      sessionId: '44444444-4444-4444-8444-444444444444',
    }).success).toBe(true);
  });
});
