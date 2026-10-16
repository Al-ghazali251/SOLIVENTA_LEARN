import { z } from 'zod';
import { templateIds, type TemplateId } from './model';

export const PageKindSchema = z.enum([
  'home',
  'about',
  'admissions',
  'news',
  'article',
  'contact',
  'content',
]);
export const TemplateDefinitionSchema = z.object({
  id: z.enum(templateIds),
  version: z.literal(1),
  label: z.string().min(1),
  description: z.string().min(1),
  intendedFit: z.string().min(1),
  capabilities: z.object({
    megaMenu: z.boolean(),
    announcementBar: z.boolean(),
    utilityBar: z.boolean(),
    horizontalGallery: z.boolean(),
    videoHero: z.boolean(),
  }),
  variants: z.object({
    header: z.enum(['compact', 'institutional', 'mega', 'friendly', 'minimal']),
    hero: z.enum(['split', 'cinematic', 'immersive', 'collage', 'typographic']),
    richText: z.enum(['split', 'formal', 'editorial', 'story', 'numbered']),
    statistics: z.enum(['strip', 'formal', 'oversized', 'tiles', 'index']),
    gallery: z.enum(['masonry', 'albums', 'cinematic', 'collage', 'horizontal']),
    news: z.enum(['cards', 'archive', 'editorial', 'community', 'magazine']),
    testimonials: z.enum(['cards', 'formal', 'quote', 'stories', 'minimal']),
    footer: z.enum(['columns', 'institutional', 'mega', 'community', 'minimal']),
  }),
  pageRecipes: z.record(
    PageKindSchema,
    z.object({
      width: z.enum(['narrow', 'default', 'wide', 'full']),
      rhythm: z.enum(['compact', 'standard', 'spacious', 'cinematic']),
      heroRequired: z.boolean(),
    }),
  ),
});

const recipe = (
  width: 'narrow' | 'default' | 'wide' | 'full',
  rhythm: 'compact' | 'standard' | 'spacious' | 'cinematic',
  heroRequired = false,
) => ({ width, rhythm, heroRequired });
const recipes = {
  home: recipe('full', 'spacious', true),
  about: recipe('wide', 'spacious'),
  admissions: recipe('default', 'standard'),
  news: recipe('wide', 'standard'),
  article: recipe('narrow', 'spacious'),
  contact: recipe('default', 'standard'),
  content: recipe('default', 'standard'),
};
const raw = [
  [
    'horizon',
    'Horizon',
    'Contemporary, clear and confident.',
    'General-purpose schools',
    {
      megaMenu: false,
      announcementBar: true,
      utilityBar: false,
      horizontalGallery: false,
      videoHero: false,
    },
    ['compact', 'split', 'split', 'strip', 'masonry', 'cards', 'cards', 'columns'],
  ],
  [
    'crest',
    'Crest',
    'Established, formal and prestigious.',
    'Heritage, mission and boarding schools',
    {
      megaMenu: false,
      announcementBar: false,
      utilityBar: true,
      horizontalGallery: false,
      videoHero: false,
    },
    [
      'institutional',
      'cinematic',
      'formal',
      'formal',
      'albums',
      'archive',
      'formal',
      'institutional',
    ],
  ],
  [
    'atlas',
    'Atlas',
    'International, premium and expansive.',
    'International curriculum and premium schools',
    {
      megaMenu: true,
      announcementBar: false,
      utilityBar: true,
      horizontalGallery: false,
      videoHero: true,
    },
    ['mega', 'immersive', 'editorial', 'oversized', 'cinematic', 'editorial', 'quote', 'mega'],
  ],
  [
    'mosaic',
    'Mosaic',
    'Warm, energetic and human.',
    'Nursery, primary and community schools',
    {
      megaMenu: false,
      announcementBar: true,
      utilityBar: false,
      horizontalGallery: false,
      videoHero: false,
    },
    ['friendly', 'collage', 'story', 'tiles', 'collage', 'community', 'stories', 'community'],
  ],
  [
    'editorial',
    'Editorial',
    'Bold, minimal and future-facing.',
    'Modern academies and specialist colleges',
    {
      megaMenu: false,
      announcementBar: false,
      utilityBar: false,
      horizontalGallery: true,
      videoHero: false,
    },
    ['minimal', 'typographic', 'numbered', 'index', 'horizontal', 'magazine', 'minimal', 'minimal'],
  ],
] as const;

export const templateDefinitions = Object.freeze(
  Object.fromEntries(
    raw.map(([id, label, description, intendedFit, capabilities, v]) => [
      id,
      TemplateDefinitionSchema.parse({
        id,
        version: 1,
        label,
        description,
        intendedFit,
        capabilities,
        variants: {
          header: v[0],
          hero: v[1],
          richText: v[2],
          statistics: v[3],
          gallery: v[4],
          news: v[5],
          testimonials: v[6],
          footer: v[7],
        },
        pageRecipes: recipes,
      }),
    ]),
  ) as Record<TemplateId, z.infer<typeof TemplateDefinitionSchema>>,
);

if (Object.keys(templateDefinitions).length !== templateIds.length)
  throw new Error('Template registry is incomplete.');
export function resolveTemplateDefinition(id: TemplateId) {
  return templateDefinitions[id];
}
