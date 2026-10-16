import { describe, expect, it, vi } from 'vitest';
import {
  AcademicStructureService,
  type AcademicStructureGateway,
} from '../../src/services/academic-structure.service';
import type { AuthContext } from '../../src/types/context';
import type { Bindings } from '../../src/config/bindings';

const bindings = {} as Bindings;
const admin: AuthContext = {
  userId: '22222222-2222-4222-8222-222222222222',
  schoolId: '11111111-1111-4111-8111-111111111111',
  roles: ['school_admin'],
  permissions: new Set(['academic.read', 'academic.manage', 'students.promote']),
  scope: { kind: 'school-wide' },
};
const saveRecord = vi.fn().mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' });
const bulkPromote = vi.fn().mockResolvedValue({ promoted: 2 });
const gateway: AcademicStructureGateway = {
  workspace: vi.fn().mockResolvedValue({
    classes: [],
    arms: [],
    subjects: [],
    sessions: [],
    terms: [],
    classSubjects: [],
    classTeachers: [],
    teacherAssignments: [],
    students: [],
    staff: [],
    enrollments: [],
  }),
  save: saveRecord,
  remove: vi.fn().mockResolvedValue(undefined),
  replaceClassSubjects: vi.fn().mockResolvedValue(undefined),
  assignClassTeacher: vi.fn().mockResolvedValue(undefined),
  replaceTeacherAssignments: vi.fn().mockResolvedValue(undefined),
  manageEnrollment: vi.fn().mockResolvedValue({}),
  bulkPromote,
};

describe('AcademicStructureService', () => {
  it('normalizes codes and always supplies the authenticated school and actor', async () => {
    const service = new AcademicStructureService(gateway);
    await service.save(bindings, admin, {
      entity: 'class',
      name: 'Year 7',
      code: ' y7 ',
      active: true,
    });
    expect(saveRecord).toHaveBeenCalledWith(bindings, {
      schoolId: admin.schoolId,
      actorId: admin.userId,
      record: { entity: 'class', name: 'Year 7', code: 'Y7', active: true },
    });
  });
  it('rejects invalid date ranges before calling the gateway', () => {
    const service = new AcademicStructureService(gateway);
    try {
      void service.save(bindings, admin, {
        entity: 'session',
        name: '2026/2027',
        startsOn: '2027-01-01',
        endsOn: '2026-01-01',
        status: 'planned',
      });
      throw new Error('Expected validation to fail.');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    }
  });
  it('allows sessions to be planned before their dates are confirmed', async () => {
    const service = new AcademicStructureService(gateway);
    await service.save(bindings, admin, {
      entity: 'session',
      name: '2027/2028',
      startsOn: null,
      endsOn: null,
      status: 'planned',
    });
    expect(saveRecord).toHaveBeenLastCalledWith(bindings, {
      schoolId: admin.schoolId,
      actorId: admin.userId,
      record: {
        entity: 'session',
        name: '2027/2028',
        startsOn: null,
        endsOn: null,
        status: 'planned',
      },
    });
  });
  it('denies a reader attempting a mutation', () => {
    const service = new AcademicStructureService(gateway);
    const reader = { ...admin, permissions: new Set(['academic.read'] as const) };
    try {
      void service.remove(bindings, reader, 'class', '33333333-3333-4333-8333-333333333333');
      throw new Error('Expected authorization to fail.');
    } catch (error: unknown) {
      expect(error).toMatchObject({ status: 403 });
    }
  });
  it('allows an explicitly authorized class teacher to request a promotion batch', async () => {
    const service = new AcademicStructureService(gateway);
    const teacher = {
      ...admin,
      roles: ['teacher'] as const,
      permissions: new Set(['academic.read', 'students.promote'] as const),
      scope: { kind: 'assigned-resources' as const },
    };
    const input = {
      studentIds: ['44444444-4444-4444-8444-444444444444'],
      sourceClassId: '55555555-5555-4555-8555-555555555555',
      targetSessionId: '66666666-6666-4666-8666-666666666666',
      targetClassId: '77777777-7777-4777-8777-777777777777',
      enrolledAt: '2026-09-04',
    };
    await service.bulkPromote(bindings, teacher, input);
    expect(bulkPromote).toHaveBeenCalledWith(bindings, {
      schoolId: teacher.schoolId,
      actorId: teacher.userId,
      ...input,
      targetArmId: null,
    });
  });
});
