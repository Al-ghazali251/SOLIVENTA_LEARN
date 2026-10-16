import { describe, expect, it } from 'vitest';
import contract from '../../contracts/openapi.v1.json';

describe('v1 OpenAPI contract', () => {
  it('contains every required operation with stable operation IDs', () => {
    const serialized = JSON.stringify(contract);
    for (const operationId of [
      'getLiveness',
      'getReadiness',
      'getTenantBootstrap',
      'getCurrentUser',
      'getPortalBootstrap',
      'listStudents',
      'createStudent',
      'listStaff',
      'listAttendance',
      'getReportCard',
    ])
      expect(serialized.match(new RegExp(`"operationId":"${operationId}"`, 'g'))).toHaveLength(1);
  });

  it('documents security and operational policy for protected and mutating routes', () => {
    const students = contract.paths['/v1/students'] as unknown as {
      get: { security: unknown; 'x-required-permissions': string[] };
      post: { 'x-idempotency': unknown; requestBody: { required: boolean } };
    };
    expect(students.get.security).toEqual([{ bearerAuth: [] }]);
    expect(students.get['x-required-permissions']).toEqual(['students.read']);
    expect(students.post['x-idempotency']).toEqual({ required: true, retentionHours: 24 });
    expect(students.post.requestBody.required).toBe(true);
  });

  it('does not expose persistence table names as resources', () => {
    expect(Object.keys(contract.paths)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('tenant_domains'),
        expect.stringContaining('school_memberships'),
      ]),
    );
  });
});
