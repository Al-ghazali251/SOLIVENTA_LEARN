import type { Bindings } from '../config/bindings';
import { z } from 'zod';
import { AppError } from '../errors/app-error';
import { assertPermission, assertSchoolScope } from '../permissions/authorize';
import type { AuthContext } from '../types/context';
import {
  AcademicRecordInputSchema,
  type AcademicRecordInput,
  type AcademicWorkspace,
} from '../academic/model';

export interface AcademicStructureGateway {
  workspace(bindings: Bindings, schoolId: string): Promise<AcademicWorkspace>;
  save(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; record: AcademicRecordInput },
  ): Promise<Record<string, unknown>>;
  remove(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; entity: AcademicRecordInput['entity']; id: string },
  ): Promise<void>;
  replaceClassSubjects(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; classId: string; subjectIds: readonly string[] },
  ): Promise<void>;
  assignClassTeacher(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; classId: string; teacherUserId: string | null },
  ): Promise<void>;
  replaceTeacherAssignments(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      teacherUserId: string;
      assignments: readonly { classId: string; subjectId: string }[];
    },
  ): Promise<void>;
  manageEnrollment(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      studentId: string;
      sessionId: string;
      classId: string;
      armId: string | null;
      enrolledAt: string;
      active: boolean;
    },
  ): Promise<Record<string, unknown>>;
  bulkPromote(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      studentIds: readonly string[];
      sourceClassId: string;
      targetSessionId: string;
      targetClassId: string;
      targetArmId: string | null;
      enrolledAt: string;
    },
  ): Promise<{ promoted: number }>;
}

export class AcademicStructureService {
  constructor(private readonly gateway: AcademicStructureGateway) {}
  private authorize(context: AuthContext, write = false) {
    assertSchoolScope(context, context.schoolId);
    assertPermission(context, write ? 'academic.manage' : 'academic.read');
  }
  workspace(bindings: Bindings, context: AuthContext) {
    this.authorize(context);
    return this.gateway.workspace(bindings, context.schoolId);
  }
  save(bindings: Bindings, context: AuthContext, value: unknown) {
    this.authorize(context, true);
    const parsed = AcademicRecordInputSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Academic record validation failed.',
        status: 400,
        details: { issues: parsed.error.issues },
      });
    return this.gateway.save(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      record: parsed.data,
    });
  }
  remove(
    bindings: Bindings,
    context: AuthContext,
    entity: AcademicRecordInput['entity'],
    id: string,
  ) {
    this.authorize(context, true);
    return this.gateway.remove(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      entity,
      id,
    });
  }
  replaceClassSubjects(
    bindings: Bindings,
    context: AuthContext,
    classId: string,
    subjectIds: readonly string[],
  ) {
    this.authorize(context, true);
    return this.gateway.replaceClassSubjects(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      classId,
      subjectIds: [...new Set(subjectIds)],
    });
  }
  assignClassTeacher(
    bindings: Bindings,
    context: AuthContext,
    classId: string,
    teacherUserId: string | null,
  ) {
    this.authorize(context, true);
    return this.gateway.assignClassTeacher(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      classId,
      teacherUserId,
    });
  }
  replaceTeacherAssignments(
    bindings: Bindings,
    context: AuthContext,
    teacherUserId: string,
    assignments: readonly { classId: string; subjectId: string }[],
  ) {
    this.authorize(context, true);
    return this.gateway.replaceTeacherAssignments(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      teacherUserId,
      assignments,
    });
  }
  manageEnrollment(
    bindings: Bindings,
    context: AuthContext,
    input: {
      studentId: string;
      sessionId: string;
      classId: string;
      armId?: string | null | undefined;
      enrolledAt: string;
      active?: boolean | undefined;
    },
  ) {
    this.authorize(context, true);
    const parsed = z
      .object({
        studentId: z.string().uuid(),
        sessionId: z.string().uuid(),
        classId: z.string().uuid(),
        armId: z.string().uuid().nullable().optional(),
        enrolledAt: z.string().date(),
        active: z.boolean().default(true),
      })
      .parse(input);
    return this.gateway.manageEnrollment(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      ...parsed,
      armId: parsed.armId ?? null,
    });
  }
  bulkPromote(bindings: Bindings, context: AuthContext, input: unknown) {
    assertSchoolScope(context, context.schoolId);
    assertPermission(context, 'students.promote');
    const parsed = z
      .object({
        studentIds: z.array(z.string().uuid()).min(1).max(500),
        sourceClassId: z.string().uuid(),
        targetSessionId: z.string().uuid(),
        targetClassId: z.string().uuid(),
        targetArmId: z.string().uuid().nullable().optional(),
        enrolledAt: z.string().date(),
      })
      .refine((value) => new Set(value.studentIds).size === value.studentIds.length, {
        message: 'Student selection contains duplicates.',
        path: ['studentIds'],
      })
      .parse(input);
    return this.gateway.bulkPromote(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      ...parsed,
      targetArmId: parsed.targetArmId ?? null,
    });
  }
}
