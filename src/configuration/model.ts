import { z } from 'zod';

export const templateIds = ['horizon', 'crest', 'atlas', 'mosaic', 'editorial'] as const;
export const legacyTemplateIds = ['modern-academy', 'classic-school', 'minimal-college'] as const;
export const TemplateIdSchema = z.enum([...templateIds, ...legacyTemplateIds]);
export type TemplateId = (typeof templateIds)[number];
export function normalizeTemplateId(value: z.infer<typeof TemplateIdSchema>): TemplateId {
  if (value === 'modern-academy') return 'horizon';
  if (value === 'classic-school') return 'crest';
  if (value === 'minimal-college') return 'editorial';
  return value;
}

const safeUrl = z
  .string()
  .url()
  .refine((value) => ['https:', 'http:'].includes(new URL(value).protocol));
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
function colorChannel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}
function colorLuminance(value: string) {
  return (
    colorChannel(Number.parseInt(value.slice(1, 3), 16)) * 0.2126 +
    colorChannel(Number.parseInt(value.slice(3, 5), 16)) * 0.7152 +
    colorChannel(Number.parseInt(value.slice(5, 7), 16)) * 0.0722
  );
}
function colorContrast(first: string, second: string) {
  const values = [colorLuminance(first), colorLuminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
const link = z.object({ label: z.string().min(1).max(40), href: z.string().startsWith('/') });
const image = z.object({
  url: safeUrl,
  alt: z.string().min(1).max(180),
  width: z.number().int().min(32).max(8000),
  height: z.number().int().min(32).max(8000),
  focalPoint: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .default({ x: 0.5, y: 0.5 }),
  mobileCrop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .nullable()
    .default(null),
});
const blockPresentation = z.object({
  variant: z
    .enum([
      'default',
      'split',
      'gallery',
      'background',
      'orbit',
      'pillars',
      'spotlight',
      'carousel',
      'stacked',
      'timeline',
      'portraits',
      'logos',
      'showcase',
    ])
    .default('default'),
  backgroundImage: image.nullable().default(null),
  overlayOpacity: z.number().min(0).max(0.9).default(0),
  animation: z.enum(['none', 'reveal', 'fade', 'rise']).default('reveal'),
});
export const BlockSchema = z
  .discriminatedUnion('type', [
    z.object({
      id: z.string().uuid(),
      type: z.literal('hero'),
      heading: z.string().min(1).max(120),
      body: z.string().max(500),
      imageUrl: safeUrl.nullable(),
      media: image.nullable().optional(),
      secondaryMedia: z.array(image).max(3).default([]),
      eyebrow: z.string().max(80).nullable().optional(),
      primaryAction: link.nullable(),
      secondaryAction: link.nullable().optional(),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('richText'),
      heading: z.string().max(120).nullable(),
      paragraphs: z.array(z.string().min(1).max(1000)).max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('contact'),
      heading: z.string().max(120),
      showMap: z.boolean(),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('news'),
      heading: z.string().max(120),
      limit: z.number().int().min(1).max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('admissionsCta'),
      heading: z.string().max(120),
      body: z.string().max(500),
      label: z.string().max(40),
      href: z.string().startsWith('/'),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('statistics'),
      heading: z.string().max(120).nullable(),
      items: z
        .array(
          z.object({
            value: z.string().min(1).max(30),
            label: z.string().min(1).max(80),
            supportingText: z.string().max(180).nullable(),
          }),
        )
        .min(1)
        .max(8),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('principalMessage'),
      heading: z.string().max(120),
      message: z.string().min(1).max(2000),
      name: z.string().min(1).max(100),
      role: z.string().max(100),
      image: image.nullable(),
      videoUrl: safeUrl.nullable().default(null),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('gallery'),
      heading: z.string().max(120),
      syncWithGalleryPage: z.boolean().default(false),
      albums: z
        .array(z.object({ name: z.string().min(1).max(80), images: z.array(image).min(1).max(30) }))
        .min(1)
        .max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('profiles'),
      heading: z.string().max(120),
      profiles: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            role: z.string().max(100),
            bio: z.string().max(500),
            image: image.nullable(),
          }),
        )
        .min(1)
        .max(16),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('history'),
      heading: z.string().max(120),
      introduction: z.string().max(700).nullable(),
      items: z
        .array(
          z.object({
            period: z.string().min(1).max(40),
            title: z.string().min(1).max(120),
            description: z.string().min(1).max(1000),
            image: image.nullable(),
          }),
        )
        .min(1)
        .max(16),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('programmes'),
      heading: z.string().max(120),
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            description: z.string().max(500),
            href: z.string().startsWith('/').nullable(),
          }),
        )
        .min(1)
        .max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('curriculum'),
      heading: z.string().min(1).max(120),
      introduction: z.string().max(700),
      items: z
        .array(
          z.object({
            title: z.string().min(1).max(100),
            ageRange: z.string().max(80),
            description: z.string().min(1).max(700),
            subjects: z.array(z.string().min(1).max(60)).max(16),
            image: image.nullable(),
          }),
        )
        .min(1)
        .max(8),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('activities'),
      heading: z.string().min(1).max(120),
      introduction: z.string().max(700),
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            category: z.string().max(60),
            description: z.string().min(1).max(500),
            image: image.nullable(),
          }),
        )
        .min(1)
        .max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('boarding'),
      heading: z.string().min(1).max(120),
      introduction: z.string().min(1).max(1000),
      availability: z.string().max(180),
      features: z.array(z.string().min(1).max(180)).min(1).max(12),
      images: z.array(image).min(1).max(4),
      action: link.nullable(),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('events'),
      heading: z.string().max(120),
      items: z
        .array(
          z.object({
            title: z.string().min(1).max(120),
            startsAt: z.string().datetime(),
            location: z.string().max(160).nullable(),
            href: z.string().startsWith('/').nullable(),
          }),
        )
        .max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('affiliations'),
      heading: z.string().max(120),
      items: z
        .array(
          z.object({ name: z.string().min(1).max(100), logo: image, href: safeUrl.nullable() }),
        )
        .min(1)
        .max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('awards'),
      heading: z.string().max(120),
      introduction: z.string().max(700).nullable(),
      items: z
        .array(
          z.object({
            title: z.string().min(1).max(140),
            year: z.string().min(1).max(20),
            description: z.string().max(700),
            image: image.nullable(),
          }),
        )
        .min(1)
        .max(16),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('editorial'),
      heading: z.string().max(120),
      body: z.string().min(1).max(1500),
      image: image,
      action: link.nullable(),
      tone: z.enum(['default', 'accent', 'dark']).default('default'),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('facilities'),
      heading: z.string().max(120),
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            description: z.string().max(500),
            image: image.nullable(),
          }),
        )
        .min(1)
        .max(12),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('testimonials'),
      heading: z.string().max(120).nullable(),
      items: z
        .array(
          z.object({
            quote: z.string().min(1).max(700),
            name: z.string().min(1).max(100),
            relationship: z.string().max(100),
          }),
        )
        .min(1)
        .max(10),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('trackRecord'),
      heading: z.string().max(120),
      items: z
        .array(
          z.object({
            value: z.string().min(1).max(30),
            label: z.string().min(1).max(100),
            description: z.string().max(300),
          }),
        )
        .min(1)
        .max(8),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('values'),
      heading: z.string().max(120),
      vision: z.string().min(1).max(1000),
      mission: z.string().min(1).max(1000),
      values: z
        .array(z.object({ title: z.string().min(1).max(80), description: z.string().max(400) }))
        .min(1)
        .max(8),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('custom'),
      eyebrow: z.string().max(80).nullable(),
      heading: z.string().min(1).max(120),
      body: z.string().min(1).max(2000),
      image: image.nullable(),
      action: link.nullable(),
      background: z.enum(['default', 'surface', 'primary', 'accent']),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('map'),
      heading: z.string().max(120),
      address: z.string().min(1).max(300),
      embedUrl: safeUrl,
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('documents'),
      heading: z.string().min(1).max(120),
      introduction: z.string().max(1000),
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(160),
            description: z.string().max(500),
            fileUrl: safeUrl,
            fileType: z.enum(['newsletter', 'calendar', 'prospectus', 'policy', 'other']),
            publishedAt: z.string().date().nullable(),
          }),
        )
        .max(24),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('admissionPortal'),
      heading: z.string().min(1).max(120),
      introduction: z.string().min(1).max(1200),
      guidanceTitle: z.string().min(1).max(120),
      guidance: z.string().min(1).max(4000),
      steps: z
        .array(
          z.object({
            title: z.string().min(1).max(80),
            description: z.string().min(1).max(300),
          }),
        )
        .min(2)
        .max(6),
      entryYears: z.array(z.string().min(1).max(40)).min(1).max(12),
      programmes: z.array(z.string().min(1).max(100)).min(1).max(24),
      classes: z
        .array(z.string().min(1).max(80))
        .min(1)
        .max(40)
        .default(['Nursery', 'Primary 1', 'Year 7', 'Year 10']),
      entrepreneurshipCourses: z
        .array(z.string().min(1).max(120))
        .min(1)
        .max(40)
        .default(['Coding and robotics', 'Fashion design', 'Catering']),
      referralSources: z
        .array(z.string().min(1).max(120))
        .min(1)
        .max(30)
        .default(['Family or friend', 'Social media', 'Online search', 'School event']),
      religions: z
        .array(z.string().min(1).max(80))
        .min(1)
        .max(20)
        .default(['Christianity', 'Islam', 'Other', 'Prefer not to say']),
      sideImage: image.nullable(),
      supportEmail: z.string().email().nullable(),
      supportPhone: z.string().max(40).nullable(),
      applicationFeeMinor: z.number().int().min(0).max(100000000).default(0),
      currency: z
        .string()
        .trim()
        .min(3)
        .max(3)
        .transform((value) => value.toUpperCase())
        .default('NGN'),
      paystackEnabled: z.boolean().default(false),
      bankTransferEnabled: z.boolean().default(false),
      bankName: z.string().max(120).default(''),
      bankAccountName: z.string().max(160).default(''),
      bankAccountNumber: z.string().max(40).default(''),
      bankInstructions: z.string().max(1000).default(''),
    }),
    z.object({
      id: z.string().uuid(),
      type: z.literal('careers'),
      heading: z.string().max(120),
      introduction: z.string().max(1000),
      openings: z
        .array(
          z.object({
            title: z.string().min(1).max(120),
            employmentType: z.string().max(80),
            location: z.string().max(120),
            summary: z.string().max(500),
            applyHref: z.string().startsWith('/'),
          }),
        )
        .max(12),
    }),
  ])
  .and(z.object({ presentation: blockPresentation.optional() }));

export const defaultPortalConfiguration = {
  branding: {
    logoUrl: null,
    backgroundImageUrl: null,
    colors: { primary: '#174c3c', accent: '#c7862d', background: '#f5f4ef', surface: '#ffffff', text: '#17231f', muted: '#62706a' },
    density: 'comfortable' as const,
    navigationStyle: 'sidebar' as const,
  },
  login: {
    eyebrow: 'School portal', heading: 'Welcome back',
    message: 'Sign in with your school account.', supportText: 'Need help signing in?',
    supportHref: '/contact/', showSchoolName: true,
  },
  terminology: {
    learner: 'Student', learners: 'Students', guardian: 'Parent or guardian',
    guardians: 'Parents and guardians', teacher: 'Teacher', teachers: 'Teachers',
    class: 'Class', classes: 'Classes', fee: 'Fee', fees: 'Fees',
  },
  roleExperiences: {
    applicant: { homeLabel: 'Application', welcomeMessage: 'Track your application and next steps.', defaultModule: 'admissions' },
    guardian: { homeLabel: 'Family overview', welcomeMessage: 'Stay connected to each learner’s progress.', defaultModule: 'overview' },
    student: { homeLabel: 'My learning', welcomeMessage: 'Continue learning and stay on track.', defaultModule: 'lessons' },
    teacher: { homeLabel: 'Teaching workspace', welcomeMessage: 'Plan, teach and support every learner.', defaultModule: 'lessons' },
    administrator: { homeLabel: 'School overview', welcomeMessage: 'Manage your school from one clear workspace.', defaultModule: 'overview' },
    specialist: { homeLabel: 'My workspace', welcomeMessage: 'Access the tools assigned to your role.', defaultModule: 'overview' },
  },
  modules: {
    students: true, staff: true, attendance: true, results: true, fees: true,
    admissions: true, parents: true, exams: true, library: true, lessons: true,
    assignments: true, messages: true,
  },
  policies: {
    sessionTimeoutMinutes: 60, requireMfaForAdministrators: false,
    allowGuardianPayments: true, allowStudentPayments: true, allowApplicantLogin: true,
    showContactDetails: true, privacyNoticeHref: '/privacy/', termsHref: '/terms/',
  },
} as const;

export const PortalConfigurationSchema = z.object({
  branding: z.object({
    logoUrl: safeUrl.nullable(), backgroundImageUrl: safeUrl.nullable(),
    colors: z.object({ primary: color, accent: color, background: color, surface: color, text: color, muted: color }),
    density: z.enum(['compact', 'comfortable', 'spacious']),
    navigationStyle: z.enum(['sidebar', 'topbar', 'rail']),
  }),
  login: z.object({
    eyebrow: z.string().min(1).max(50), heading: z.string().min(1).max(80),
    message: z.string().min(1).max(240), supportText: z.string().max(100),
    supportHref: z.string().startsWith('/'), showSchoolName: z.boolean(),
  }),
  terminology: z.object({
    learner: z.string().min(1).max(40), learners: z.string().min(1).max(40),
    guardian: z.string().min(1).max(40), guardians: z.string().min(1).max(40),
    teacher: z.string().min(1).max(40), teachers: z.string().min(1).max(40),
    class: z.string().min(1).max(40), classes: z.string().min(1).max(40),
    fee: z.string().min(1).max(40), fees: z.string().min(1).max(40),
  }),
  roleExperiences: z.record(
    z.enum(['applicant', 'guardian', 'student', 'teacher', 'administrator', 'specialist']),
    z.object({ homeLabel: z.string().min(1).max(50), welcomeMessage: z.string().min(1).max(180), defaultModule: z.string().min(1).max(40) }),
  ),
  modules: z.record(z.string().regex(/^[a-z][a-z0-9.-]{1,40}$/), z.boolean()),
  policies: z.object({
    sessionTimeoutMinutes: z.number().int().min(5).max(1440),
    requireMfaForAdministrators: z.boolean(), allowGuardianPayments: z.boolean(),
    allowStudentPayments: z.boolean(), allowApplicantLogin: z.boolean(),
    showContactDetails: z.boolean(), privacyNoticeHref: z.string().startsWith('/'),
    termsHref: z.string().startsWith('/'),
  }),
}).superRefine((portal, context) => {
  for (const [name, foreground, background] of [
    ['portal text', portal.branding.colors.text, portal.branding.colors.background],
    ['portal surface text', portal.branding.colors.text, portal.branding.colors.surface],
    ['portal action text', '#ffffff', portal.branding.colors.primary],
  ] as const)
    if (colorContrast(foreground, background) < 4.5)
      context.addIssue({ code: 'custom', message: `${name} must meet the WCAG AA contrast ratio of 4.5:1.`, path: ['branding', 'colors'] });
});

export const TenantConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    template: TemplateIdSchema,
    branding: z.object({
      logoUrl: safeUrl.nullable(),
      faviconUrl: safeUrl.nullable(),
      colors: z.object({
        primary: color,
        secondary: color,
        accent: color,
        background: color,
        surface: color,
        text: color,
        muted: color,
      }),
      fonts: z.object({
        heading: z.enum(['Merriweather', 'Playfair Display', 'Inter', 'Source Sans 3']),
        body: z.enum(['Inter', 'Source Sans 3', 'Merriweather']),
      }),
      buttonStyle: z.enum(['rounded', 'square', 'pill']),
      cardStyle: z.enum(['bordered', 'elevated', 'flat']),
      inputStyle: z.enum(['rounded', 'square', 'pill']).default('rounded'),
    }),
    contact: z.object({
      email: z.string().email(),
      phone: z.string().min(5).max(30),
      address: z.string().min(5).max(300),
    }),
    socialLinks: z
      .array(
        z.object({
          network: z.enum(['facebook', 'instagram', 'linkedin', 'youtube', 'x']),
          url: safeUrl,
        }),
      )
      .max(8),
    portal: PortalConfigurationSchema.default(defaultPortalConfiguration),
    features: z.record(z.string().regex(/^[a-z][a-z0-9.-]{1,60}$/), z.boolean()),
    navigation: z
      .array(
        z.object({
          label: z.string().min(1).max(50),
          href: z.string().startsWith('/'),
          requiredFeature: z.string().nullable(),
        }),
      )
      .max(20),
    mediaLibrary: z
      .array(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).max(120),
          url: safeUrl,
          alt: z.string().min(1).max(240),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        }),
      )
      .max(200)
      .default([]),
    pages: z
      .array(
        z.object({
          slug: z.string().regex(/^\/$|^\/[a-z0-9/-]+$/),
          title: z.string().min(1).max(120),
          visible: z.boolean(),
          seo: z
            .object({
              title: z.string().max(70).default(''),
              description: z.string().max(170).default(''),
              socialImage: safeUrl.nullable().default(null),
              noindex: z.boolean().default(false),
            })
            .default({ title: '', description: '', socialImage: null, noindex: false }),
          blocks: z.array(BlockSchema).max(30),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((config, context) => {
    for (const [name, foreground, background] of [
      ['page text', config.branding.colors.text, config.branding.colors.background],
      ['surface text', config.branding.colors.text, config.branding.colors.surface],
      ['primary action text', '#ffffff', config.branding.colors.primary],
    ] as const)
      if (colorContrast(foreground, background) < 4.5)
        context.addIssue({
          code: 'custom',
          message: `${name} must meet the WCAG AA contrast ratio of 4.5:1.`,
          path: ['branding', 'colors'],
        });
    if (!config.pages.some((page) => page.slug === '/' && page.visible))
      context.addIssue({
        code: 'custom',
        message: 'A visible home page is required.',
        path: ['pages'],
      });
    const slugs = config.pages.map((page) => page.slug);
    if (new Set(slugs).size !== slugs.length)
      context.addIssue({ code: 'custom', message: 'Page slugs must be unique.', path: ['pages'] });
  });

export type TenantConfiguration = z.infer<typeof TenantConfigurationSchema>;
export type CanonicalTenantConfiguration = Omit<TenantConfiguration, 'template'> & {
  template: TemplateId;
};

const normalizeFeatureKey = (key: string) => {
  if (key === 'websiteStudio') return 'website.studio';
  if (key === 'payments') return 'payments.online';
  if (key === 'classes' || key === 'academic') return 'portal.academic';
  const portalFeatureKeys = new Set([
    'students', 'staff', 'attendance', 'results', 'fees', 'parents',
    'messaging', 'exams', 'assignments', 'lessons', 'library',
  ]);
  return portalFeatureKeys.has(key) ? `portal.${key === 'messaging' ? 'messages' : key}` : key;
};

export function migrateTenantConfiguration(input: unknown): CanonicalTenantConfiguration {
  const rawSource = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const normalizeFragmentLinks = (value: unknown, pageSlug: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => normalizeFragmentLinks(item, pageSlug));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === 'href' && typeof item === 'string' && item.startsWith('#')
            ? `${pageSlug}${item}`
            : normalizeFragmentLinks(item, pageSlug),
        ]),
      );
    return value;
  };
  const rawFeatures = rawSource.features && typeof rawSource.features === 'object' && !Array.isArray(rawSource.features)
    ? rawSource.features as Record<string, unknown>
    : {};
  const features = Object.fromEntries(
    Object.entries(rawFeatures).map(([key, enabled]) => [
      normalizeFeatureKey(key),
      enabled,
    ]),
  );
  const navigation = Array.isArray(rawSource.navigation)
    ? rawSource.navigation.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const value = item as Record<string, unknown>;
        return {
          ...value,
          requiredFeature: typeof value.requiredFeature === 'string'
            ? normalizeFeatureKey(value.requiredFeature)
            : value.requiredFeature,
        };
      })
    : rawSource.navigation;
  const pages = Array.isArray(rawSource.pages)
    ? rawSource.pages.map((page) => {
        if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
        const value = page as Record<string, unknown>;
        const slug = typeof value.slug === 'string' ? value.slug : '/';
        return normalizeFragmentLinks(value, slug);
      })
    : rawSource.pages;
  const source: Record<string, unknown> = { ...rawSource, features, navigation, pages };
  const savedPortal = source.portal && typeof source.portal === 'object' && !Array.isArray(source.portal)
    ? source.portal as Record<string, unknown>
    : {};
  const mergeSection = (key: keyof typeof defaultPortalConfiguration) => {
    const saved = savedPortal[key];
    const baseline = defaultPortalConfiguration[key];
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? { ...baseline, ...saved }
      : baseline;
  };
  const savedBranding = mergeSection('branding') as Record<string, unknown>;
  const savedColors = savedBranding.colors && typeof savedBranding.colors === 'object'
    ? savedBranding.colors as Record<string, unknown>
    : {};
  const parsed = TenantConfigurationSchema.parse({
    ...source,
    portal: {
      ...defaultPortalConfiguration,
      ...savedPortal,
      branding: {
        ...defaultPortalConfiguration.branding,
        ...savedBranding,
        colors: { ...defaultPortalConfiguration.branding.colors, ...savedColors },
      },
      login: mergeSection('login'),
      terminology: mergeSection('terminology'),
      roleExperiences: mergeSection('roleExperiences'),
      modules: mergeSection('modules'),
      policies: mergeSection('policies'),
    },
  });
  return { ...parsed, template: normalizeTemplateId(parsed.template) };
}
export type ConfigurationVersion = Readonly<{
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  configuration: TenantConfiguration;
  createdAt: string;
  publishedAt: string | null;
}>;

export function effectiveFeatures(
  platform: Record<string, boolean>,
  entitlement: Record<string, boolean>,
  requested: Record<string, boolean>,
) {
  return Object.fromEntries(
    Object.keys(requested).map((key) => [
      key,
      requested[key] === true && platform[key] === true && entitlement[key] === true,
    ]),
  );
}

export function effectiveNavigation(
  navigation: TenantConfiguration['navigation'],
  features: Readonly<Record<string, boolean>>,
) {
  return navigation.filter(
    (item) => item.requiredFeature === null || features[item.requiredFeature] === true,
  );
}
