import { describe, expect, it } from 'vitest';
import { calculateFeeBalance } from '../../src/fees/balance';
import { gradeScore } from '../../src/results/grading';
import { permissionsForRoles } from '../../src/permissions/roles';
import { normalizeCustomHostname } from '../../src/domains/model';
import {
  effectiveFeatures,
  effectiveNavigation,
  TenantConfigurationSchema,
} from '../../src/configuration/model';
import { shouldApplyProviderEvent, transitionPayment } from '../../src/payments/state-machine';

describe('Phase 14 pure domain rules', () => {
  it('calculates grades at boundaries and rejects invalid scores', () => {
    const bands = [
      { minimumPercent: 70, grade: 'A', remark: 'Excellent' },
      { minimumPercent: 50, grade: 'C', remark: 'Credit' },
      { minimumPercent: 0, grade: 'F', remark: 'Needs improvement' },
    ];
    expect(gradeScore(35, 50, bands)).toMatchObject({ percentage: 70, grade: 'A' });
    expect(gradeScore(25, 50, bands)).toMatchObject({ percentage: 50, grade: 'C' });
    expect(() => gradeScore(51, 50, bands)).toThrow(/valid range/u);
  });

  it('calculates unpaid, partial, paid, and credit fee balances in minor units', () => {
    expect(calculateFeeBalance(10_000, [])).toMatchObject({
      status: 'unpaid',
      outstandingMinor: 10_000,
    });
    expect(calculateFeeBalance(10_000, [4_000])).toMatchObject({
      status: 'partial',
      outstandingMinor: 6_000,
    });
    expect(calculateFeeBalance(10_000, [10_000])).toMatchObject({
      status: 'paid',
      outstandingMinor: 0,
    });
    expect(calculateFeeBalance(10_000, [12_000])).toMatchObject({
      status: 'credit',
      creditedMinor: 2_000,
    });
    expect(() => calculateFeeBalance(10_000, [10.5])).toThrow(/minor units/u);
  });

  it('maps roles to explicit permissions without accidental elevation', () => {
    const teacher = permissionsForRoles(['teacher']);
    expect(teacher.has('results.record')).toBe(true);
    expect(teacher.has('staff.manage')).toBe(false);
    expect(teacher.has('domains.manage')).toBe(false);
    const applicant = permissionsForRoles(['applicant']);
    expect(applicant.has('applicant.self.read')).toBe(true);
    expect(applicant.has('students.read')).toBe(false);
    expect(applicant.has('results.read')).toBe(false);
    const admissionsOfficer = permissionsForRoles(['admissions_officer']);
    expect(admissionsOfficer.has('admissions.manage')).toBe(true);
    expect(admissionsOfficer.has('school.configure')).toBe(false);
  });

  it('normalizes custom domains and prevents claims beneath the platform domain', () => {
    expect(normalizeCustomHostname(' School.Example.COM. ', 'schools.soliventa.test')).toBe(
      'school.example.com',
    );
    expect(() =>
      normalizeCustomHostname('greenfield.schools.soliventa.test', 'schools.soliventa.test'),
    ).toThrow(/cannot be claimed/u);
  });

  it('intersects feature availability and removes navigation for disabled features', () => {
    const features = effectiveFeatures(
      { news: true, admissions: true },
      { news: true, admissions: false },
      { news: true, admissions: true },
    );
    expect(features).toEqual({ news: true, admissions: false });
    expect(
      effectiveNavigation(
        [
          { label: 'Home', href: '/', requiredFeature: null },
          { label: 'News', href: '/news', requiredFeature: 'news' },
          { label: 'Apply', href: '/admissions', requiredFeature: 'admissions' },
        ],
        features,
      ).map((item) => item.label),
    ).toEqual(['Home', 'News']);
  });

  it('rejects unsafe or incomplete tenant content configuration', () => {
    expect(
      TenantConfigurationSchema.safeParse({
        schemaVersion: 1,
        template: 'modern-academy',
        branding: {
          logoUrl: 'javascript:alert(1)',
          faviconUrl: null,
          colors: {},
          fonts: {},
          buttonStyle: 'rounded',
          cardStyle: 'flat',
        },
        contact: {},
        socialLinks: [],
        features: {},
        navigation: [],
        pages: [],
      }).success,
    ).toBe(false);
  });

  it('allows only valid payment transitions and deduplicates provider events', () => {
    expect(transitionPayment('initialized', 'pending')).toBe('pending');
    expect(transitionPayment('pending', 'successful')).toBe('successful');
    expect(() => transitionPayment('successful', 'pending')).toThrow(/cannot transition/u);
    expect(shouldApplyProviderEvent(new Set(['evt_1']), 'evt_1')).toBe(false);
    expect(shouldApplyProviderEvent(new Set(['evt_1']), 'evt_2')).toBe(true);
  });
});
