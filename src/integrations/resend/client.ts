import type { Bindings } from '../../config/bindings';
import { structuredLog } from '../../observability/telemetry';

type EmailInput = Readonly<{
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
  schoolId?: string;
}>;
export type EmailBranding = Readonly<{
  schoolName: string;
  portalUrl: string;
  logoUrl?: string | null;
  primaryColor?: string | undefined;
  accentColor?: string | undefined;
  contact?: string[];
  actionUrl?: string;
  actionLabel?: string;
}>;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export const paragraphs = (lines: string[]) =>
  lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
export function brandedEmail(lines: string[], branding: EmailBranding) {
  const primary = /^#[0-9a-f]{6}$/i.test(branding.primaryColor ?? '')
    ? branding.primaryColor
    : '#104b3f';
  const accent = /^#[0-9a-f]{6}$/i.test(branding.accentColor ?? '')
    ? branding.accentColor
    : '#d28a35';
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" width="64" alt="${escapeHtml(branding.schoolName)} logo" style="display:block;max-height:64px;max-width:96px;object-fit:contain;margin:0 auto 14px">`
    : '';
  const content = lines
    .map((line, index) =>
      index === 0
        ? `<p style="font-size:18px;font-weight:700;margin:0 0 18px">${escapeHtml(line)}</p>`
        : `<p style="margin:0 0 14px;line-height:1.65">${escapeHtml(line)}</p>`,
    )
    .join('');
  const contact = (branding.contact ?? []).filter(Boolean).map(escapeHtml).join(' &nbsp;•&nbsp; ');
  const actionUrl = branding.actionUrl || branding.portalUrl;
  const actionLabel = branding.actionLabel || 'Open school portal';
  return `<!doctype html><html><body style="margin:0;background:#f3f5f4;font-family:Arial,sans-serif;color:#17231f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f4;padding:32px 12px"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 35px rgba(18,45,37,.10)"><tr><td style="height:7px;background:${accent}"></td></tr><tr><td align="center" style="padding:30px 28px 24px;background:${primary};color:#fff">${logo}<div style="font-size:22px;font-weight:800">${escapeHtml(branding.schoolName)}</div>${contact ? `<div style="font-size:12px;opacity:.85;margin-top:8px">${contact}</div>` : ''}</td></tr><tr><td style="padding:34px 38px;font-size:15px">${content}<p style="margin:28px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:${accent};color:#fff;text-decoration:none;font-weight:700">${escapeHtml(actionLabel)}</a></p></td></tr><tr><td align="center" style="padding:20px;background:#f7f9f8;border-top:1px solid #e1e7e4;color:#68756f;font-size:12px">Sent by ${escapeHtml(branding.schoolName)}<br><span style="display:inline-block;margin-top:7px">Powered by <a href="https://soliventa.tech" style="color:${primary};font-weight:700;text-decoration:none">Soliventa Tech</a></span></td></tr></table></td></tr></table></body></html>`;
}

export async function sendTransactionalEmail(bindings: Bindings, input: EmailInput) {
  if (!bindings.RESEND_API_KEY || !bindings.RESEND_FROM_EMAIL) {
    structuredLog('warn', {
      type: 'email_skipped',
      environment: bindings.APP_ENV,
      schoolId: input.schoolId,
      outcome: 'not_configured',
    });
    return null;
  }
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bindings.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from: bindings.RESEND_FROM_EMAIL,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? paragraphs(input.text.split('\n').filter(Boolean)),
        ...(bindings.RESEND_REPLY_TO_EMAIL ? { reply_to: bindings.RESEND_REPLY_TO_EMAIL } : {}),
      }),
    });
    if (response.ok || (response.status < 500 && response.status !== 429)) break;
  }
  if (!response) return null;
  if (!response.ok) {
    structuredLog('error', {
      type: 'email_delivery',
      environment: bindings.APP_ENV,
      schoolId: input.schoolId,
      outcome: 'failed',
      status: response.status,
    });
    return null;
  }
  const body = (await response.json()) as { id?: string };
  structuredLog('info', {
    type: 'email_delivery',
    environment: bindings.APP_ENV,
    schoolId: input.schoolId,
    outcome: 'sent',
  });
  return body.id ?? null;
}
