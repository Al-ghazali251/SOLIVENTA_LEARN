import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../../src/config/bindings';
import { brandedEmail, sendTransactionalEmail } from '../../src/integrations/resend/client';
afterEach(() => vi.unstubAllGlobals());
describe('Resend transactional email', () => {
  it('uses server credentials and an idempotency key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'email_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const id = await sendTransactionalEmail(
      {
        APP_ENV: 'production',
        RESEND_API_KEY: 're_test',
        RESEND_FROM_EMAIL: 'School <notifications@learn.soliventa.tech>',
        PORTAL_ORIGIN: 'https://portal.learn.soliventa.tech',
      } as Bindings,
      {
        to: 'parent@example.test',
        subject: 'Update',
        text: 'Hello',
        idempotencyKey: 'event-1234567890123456',
      },
    );
    expect(id).toBe('email_1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'event-1234567890123456' }),
      }),
    );
  });
  it('does not call the network when email is unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      sendTransactionalEmail({ APP_ENV: 'development' } as Bindings, {
        to: 'a@example.test',
        subject: 'Update',
        text: 'Hello',
        idempotencyKey: 'event-1234567890123456',
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('renders school branding with a Soliventa attribution', () => {
    const html = brandedEmail(['Hello Parent', 'Your account is ready.'], {
      schoolName: 'Meridian Academy',
      portalUrl: 'https://portal.meridian.test',
      logoUrl: 'https://cdn.test/logo.png',
      primaryColor: '#4B164C',
      accentColor: '#D6A84B',
      contact: ['Lagos', 'office@example.test'],
    });
    expect(html).toContain('Meridian Academy');
    expect(html).toContain('#4B164C');
    expect(html).toContain('https://cdn.test/logo.png');
    expect(html).toContain('Powered by');
    expect(html).toContain('https://soliventa.tech');
  });
});
