import type { Bindings } from '../config/bindings';

type LogLevel = 'info' | 'warn' | 'error';
type LogFields = Readonly<{
  type: string;
  requestId?: string | undefined;
  traceId?: string | undefined;
  environment?: string | undefined;
  hostname?: string | undefined;
  schoolId?: string | undefined;
  userId?: string | undefined;
  route?: string | undefined;
  method?: string | undefined;
  status?: number | undefined;
  durationMs?: number | undefined;
  errorCode?: string | undefined;
  operation?: string | undefined;
  jobId?: string | undefined;
  attempt?: number | undefined;
  outcome?: string | undefined;
}>;

export function structuredLog(level: LogLevel, fields: LogFields) {
  const value = JSON.stringify(
    Object.fromEntries(Object.entries(fields).filter(([, item]) => item !== undefined)),
  );
  if (level === 'error') console.error(value);
  else if (level === 'warn') console.warn(value);
  else console.log(value);
}

export type MetricEvent = Readonly<{
  type: string;
  schoolId?: string | undefined;
  environment: string;
  route?: string | undefined;
  method?: string | undefined;
  status?: number | undefined;
  durationMs?: number | undefined;
  errorCode?: string | undefined;
  hostname?: string | undefined;
  operation?: string | undefined;
  outcome?: string | undefined;
  value?: number | undefined;
  template?: string | undefined;
  device?: string | undefined;
  country?: string | undefined;
}>;

export function recordMetric(bindings: Bindings, event: MetricEvent) {
  bindings.METRICS?.writeDataPoint({
    blobs: [
      event.type,
      event.environment,
      event.route ?? '',
      event.method ?? '',
      String(event.status ?? ''),
      event.errorCode ?? '',
      event.hostname ?? '',
      event.operation ?? '',
      event.outcome ?? '',
      event.template ?? '',
      event.device ?? '',
      event.country ?? '',
    ],
    doubles: [1, event.durationMs ?? 0, event.value ?? 0],
    indexes: [event.schoolId ?? 'platform'],
  });
}

export function normalizedRoute(path: string) {
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function errorCode(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'UNEXPECTED_EXCEPTION';
}
