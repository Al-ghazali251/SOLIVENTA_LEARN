import { describe, expect, it } from 'vitest';
import type { Bindings } from '../../src/config/bindings';
import {
  defaultPortalConfiguration,
  PortalConfigurationSchema,
  TenantConfigurationSchema,
  effectiveFeatures,
  migrateTenantConfiguration,
} from '../../src/configuration/model';
import { templateDefinitions, TemplateDefinitionSchema } from '../../src/configuration/templates';
import { issuePreviewToken, verifyPreviewToken } from '../../src/configuration/preview-token';

const schoolId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const bindings = {
  PREVIEW_TOKEN_SECRET: 'a-secure-preview-secret-with-more-than-32-characters',
} as Bindings;

describe('configuration studio security', () => {
  it('validates portal readability and accepts the safe defaults', () => {
    expect(PortalConfigurationSchema.safeParse(defaultPortalConfiguration).success).toBe(true);
    expect(
      PortalConfigurationSchema.safeParse({
        ...defaultPortalConfiguration,
        branding: {
          ...defaultPortalConfiguration.branding,
          colors: { ...defaultPortalConfiguration.branding.colors, text: '#777777', background: '#777777' },
        },
      }).success,
    ).toBe(false);
  });
  it('intersects platform, subscription, and requested features', () => {
    expect(
      effectiveFeatures(
        { news: true, ai: true },
        { news: true, ai: false },
        { news: true, ai: true },
      ),
    ).toEqual({ news: true, ai: false });
  });
  it('rejects configuration without a visible home page', () => {
    expect(TenantConfigurationSchema.safeParse({ schemaVersion: 1, pages: [] }).success).toBe(
      false,
    );
  });
  it('binds preview tokens to the exact school and draft', async () => {
    const issued = await issuePreviewToken(bindings, { schoolId, versionId, actorId });
    await expect(
      verifyPreviewToken(bindings, issued.token, { schoolId, versionId }),
    ).resolves.toMatchObject({ schoolId, versionId });
    await expect(
      verifyPreviewToken(bindings, issued.token, { schoolId, versionId: actorId }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('has five complete, strictly validated template definitions', () => {
    expect(Object.keys(templateDefinitions)).toHaveLength(5);
    for (const definition of Object.values(templateDefinitions))
      expect(TemplateDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(
      TemplateDefinitionSchema.safeParse({
        ...templateDefinitions.horizon,
        variants: { ...templateDefinitions.horizon.variants, hero: 'unknown' },
      }).success,
    ).toBe(false);
  });
  it.each([
    ['modern-academy', 'horizon'],
    ['classic-school', 'crest'],
    ['minimal-college', 'editorial'],
  ] as const)(
    'migrates legacy draft %s and preserves content for rollback',
    (legacy, canonical) => {
      const source = {
        schemaVersion: 1 as const,
        template: legacy,
        branding: {
          logoUrl: null,
          faviconUrl: null,
          colors: {
            primary: '#17345c',
            secondary: '#e7dfcb',
            accent: '#705019',
            background: '#faf8f2',
            surface: '#ffffff',
            text: '#182438',
            muted: '#555f6d',
          },
          fonts: { heading: 'Merriweather' as const, body: 'Inter' as const },
          buttonStyle: 'square' as const,
          cardStyle: 'bordered' as const,
          inputStyle: 'rounded' as const,
        },
        contact: {
          email: 'school@example.test',
          phone: '+234 800 000 0000',
          address: '1 Synthetic Avenue',
        },
        socialLinks: [],
        features: { news: true },
        navigation: [],
        pages: [
          {
            slug: '/',
            title: 'Home',
            visible: true,
            blocks: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                type: 'richText' as const,
                heading: 'Welcome',
                paragraphs: ['Published content remains intact.'],
              },
            ],
          },
        ],
      };
      const migrated = migrateTenantConfiguration(source);
      expect(migrated.template).toBe(canonical);
      expect(migrated.pages[0]?.blocks).toEqual(source.pages[0]?.blocks);
      const legacyPortal = migrateTenantConfiguration({ ...source, portal: { modules: { lessons: false } } });
      expect(legacyPortal.portal.modules.lessons).toBe(false);
      expect(legacyPortal.portal.policies.allowGuardianPayments).toBe(true);
      expect(migrated.pages[0]?.seo).toEqual({
        title: '',
        description: '',
        socialImage: null,
        noindex: false,
      });
      expect(migrated.mediaLibrary).toEqual([]);
      expect(migrateTenantConfiguration(migrated)).toEqual(migrated);

      const legacyLinks = migrateTenantConfiguration({
        ...source,
        features: { websiteStudio: true, classes: true },
        navigation: [{ label: 'Classes', href: '/classes/', requiredFeature: 'classes' }],
        pages: [
          {
            slug: '/',
            title: 'Home',
            visible: true,
            blocks: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                type: 'hero',
                heading: 'Explore the school',
                body: 'A legacy configuration with an on-page action.',
                imageUrl: null,
                primaryAction: { label: 'Explore', href: '#details' },
              },
            ],
          },
        ],
      });
      expect(legacyLinks.features).toEqual({ 'website.studio': true, 'portal.academic': true });
      expect(legacyLinks.navigation[0]?.requiredFeature).toBe('portal.academic');
      expect(legacyLinks.pages[0]?.blocks[0]).toMatchObject({
        primaryAction: { href: '/#details' },
      });
    },
  );
  it('rejects unknown templates and block variants before a draft can publish', () => {
    const invalid = {
      schemaVersion: 1,
      template: 'unknown-template',
      branding: {},
      contact: {},
      socialLinks: [],
      features: {},
      navigation: [],
      pages: [
        {
          slug: '/',
          title: 'Home',
          visible: true,
          blocks: [{ id: versionId, type: 'unknown-block' }],
        },
      ],
    };
    expect(TenantConfigurationSchema.safeParse(invalid).success).toBe(false);
  });
});
