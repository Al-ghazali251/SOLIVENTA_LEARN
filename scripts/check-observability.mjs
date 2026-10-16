import { readFile } from 'node:fs/promises';

const requiredAlerts = new Set([
  'elevated-5xx',
  'authentication-anomaly',
  'cross-tenant-test-failure',
  'payment-verification-failure',
  'database-connection-failure',
  'background-queue-buildup',
  'domain-certificate-failure',
  'public-lcp-regression',
  'backup-failure',
]);
const requiredDashboards = new Set(['platform-health', 'tenant-health', 'public-experience']);
const alerts = JSON.parse(await readFile('ops/observability/alerts.json', 'utf8'));
const dashboards = JSON.parse(await readFile('ops/observability/dashboards.json', 'utf8'));
for (const item of alerts.alerts) requiredAlerts.delete(item.id);
for (const item of dashboards.dashboards) requiredDashboards.delete(item.id);
if (!alerts.destinationEnvironmentVariable || requiredAlerts.size || requiredDashboards.size) {
  throw new Error(
    `Incomplete observability configuration: alerts=${[...requiredAlerts]}, dashboards=${[...requiredDashboards]}`,
  );
}
console.log('Observability alert and dashboard manifests are complete.');
