import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateLesson,
  freeLessonModel,
  GenerationRetryError,
} from '../../src/integrations/openrouter/lesson-generator';
import { studentLessonContent } from '../../src/lessons/ai-model';
import { CompletePlatformService } from '../../src/services/complete-platform.service';
import type { CompletePlatformGateway } from '../../src/services/complete-platform.service';
import type { Bindings } from '../../src/config/bindings';
import type { AuthContext } from '../../src/types/context';

const env = { OPENROUTER_API_KEY: 'test-secret' } as Bindings;
const lesson = {
  title: 'Fractions',
  summary: 'Understand fractions.',
  objectives: ['Compare fractions'],
  sections: ['Explanation', 'Worked examples', 'Practice', 'Homework'].map((heading, i) => ({
    id: String(i),
    type: 'paragraph',
    heading,
    text: 'Lesson content',
    items: [],
  })),
  teacherNotes: 'Private marking guidance',
};
afterEach(() => vi.unstubAllGlobals());
describe('AI lesson generation', () => {
  it('permits provider data collection only with explicit configuration', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(lesson) } }],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    await generateLesson({ ...env, OPENROUTER_DATA_COLLECTION: 'allow' }, {});
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(typeof init.body === 'string' && JSON.parse(init.body)).toMatchObject({
      provider: { data_collection: 'allow' },
    });
  });
  it('explains privacy-policy rejection without exposing provider text or retrying', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            message:
              'No endpoints found matching your data policy (Free model training). secret prompt text',
          },
        },
        { status: 404 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const error: unknown = await generateLesson(env, {}).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'AI_PRIVACY_POLICY_BLOCKED' });
    expect(error instanceof Error && error.message).not.toContain('secret prompt text');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    [401, 'AI_KEY_INVALID'],
    [402, 'AI_CREDIT_LIMIT'],
    [404, 'AI_MODEL_UNAVAILABLE'],
  ])('classifies HTTP %s configuration failures', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: Number(status) })));
    await expect(generateLesson(env, {})).rejects.toMatchObject({ code });
  });
  it('accepts only explicitly free routing', () => {
    expect(freeLessonModel(env)).toBe('openrouter/free');
    expect(freeLessonModel({ ...env, OPENROUTER_MODEL: 'vendor/model:free' })).toBe(
      'vendor/model:free',
    );
    for (const model of ['openrouter/auto', 'openrouter/auto:free', 'vendor/paid']) {
      expect(() => freeLessonModel({ ...env, OPENROUTER_MODEL: model })).toThrow();
    }
  });
  it('validates output and requests structured free-only inference', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        model: 'vendor/free-model',
        usage: { total_tokens: 100 },
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(lesson) } }],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await generateLesson(env, { topic: 'Fractions' });
    expect(result.lesson).toEqual(lesson);
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    const request = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      model: string;
      max_tokens: number;
      reasoning: { effort: string };
      provider: unknown;
      response_format: { json_schema: { strict: boolean } };
      models?: unknown;
    };
    expect(request.model).toBe('openrouter/free');
    expect(request.max_tokens).toBe(10000);
    expect(request.reasoning.effort).toBe('low');
    expect(request.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.models).toBeUndefined();
  });
  it('honours provider retry timing without a paid fallback', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '300' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(generateLesson(env, {})).rejects.toMatchObject({ delaySeconds: 300 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects truncated or invalid documents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ finish_reason: 'length', message: { content: JSON.stringify(lesson) } }],
        }),
      ),
    );
    await expect(generateLesson(env, {})).rejects.toMatchObject({ code: 'AI_INCOMPLETE_OUTPUT' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ finish_reason: 'stop', message: { content: '{"title":"Only a title"}' } }],
        }),
      ),
    );
    await expect(generateLesson(env, {})).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });
  it('allows only student fields, including within sections', () => {
    const content = studentLessonContent({
      ...lesson,
      answerKey: 'secret',
      sections: [
        { id: '1', type: 'paragraph', text: 'Public', answerKey: 'secret' },
        { id: '2', audience: 'teacher', text: 'Private' },
      ],
    });
    expect(content).toEqual({
      objectives: lesson.objectives,
      sections: [
        { id: '1', type: 'paragraph', heading: undefined, text: 'Public', items: undefined },
      ],
    });
    expect(JSON.stringify(content)).not.toContain('secret');
    expect(JSON.stringify(content)).not.toContain('Private');
  });
  it('denies students generation and teachers curriculum approval', () => {
    const execute = vi.fn();
    const service = new CompletePlatformService({ execute } as unknown as CompletePlatformGateway);
    const context = {
      schoolId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      roles: ['student'],
      permissions: new Set(['lessons.read']),
      scope: { kind: 'self' },
    } as AuthContext;
    expect(() =>
      service.execute(env, context, {
        operation: 'lesson.generate',
        classroomId: context.schoolId,
        topicId: context.schoolId,
        requestKey: context.schoolId,
      }),
    ).toThrow();
    expect(() =>
      service.execute(
        env,
        { ...context, roles: ['teacher'], permissions: new Set(['lessons.manage']) },
        {
          operation: 'curriculum.create',
          classroomId: context.schoolId,
          curriculum: 'Approved',
          version: '1',
          term: 'First',
          week: 1,
          topic: 'Fractions',
          objectives: ['Compare'],
          sourceExcerpt: 'A'.repeat(60),
          sourceReference: 'Page 2',
        },
      ),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('classifies provider timeouts without exposing network details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('private detail', 'TimeoutError')));
    await expect(generateLesson(env, {})).rejects.toMatchObject({ code: 'AI_PROVIDER_TIMEOUT', delaySeconds: 60 });
    await expect(generateLesson(env, {})).rejects.not.toThrow('private detail');
  });
  it('exposes a bounded queue retry delay', () => {
    expect(new GenerationRetryError(180).delaySeconds).toBe(180);
  });
});
