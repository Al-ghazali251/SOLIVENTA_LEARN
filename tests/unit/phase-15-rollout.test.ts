import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(await readFile('ops/staging/representative-tenants.json', 'utf8')) as {
  tenants: Array<{
    code: string;
    scenario: string;
    studentCount: number;
    payments: boolean;
    customDomain?: string;
  }>;
};

describe('Phase 15 rollout fixtures', () => {
  it('contains every required representative tenant scenario', () => {
    const scenarios = new Set(manifest.tenants.map((tenant) => tenant.scenario));
    expect(scenarios).toEqual(
      new Set([
        'small-primary',
        'large-secondary',
        'custom-domain',
        'portal-subdomain',
        'online-payment',
        'no-payment',
        'extensive-branding',
      ]),
    );
  });

  it('has unique codes and bounded synthetic population sizes', () => {
    const codes = manifest.tenants.map((tenant) => tenant.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(
      manifest.tenants.every((tenant) => tenant.studentCount > 0 && tenant.studentCount <= 2_000),
    ).toBe(true);
  });

  it('includes both payment states and keeps the custom hostname non-production', () => {
    expect(manifest.tenants.some((tenant) => tenant.payments)).toBe(true);
    expect(manifest.tenants.some((tenant) => !tenant.payments)).toBe(true);
    const custom = manifest.tenants.find((tenant) => tenant.scenario === 'custom-domain');
    expect(custom?.customDomain).toMatch(/\.example$/u);
  });
});
