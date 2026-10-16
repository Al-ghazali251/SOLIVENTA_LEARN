/* global __ENV */
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    warm_bootstrap: { executor: 'constant-vus', vus: 20, duration: '30s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

const baseUrl = __ENV.API_BASE_URL || 'http://school-a.127-0-0-1.nip.io:8787';

export default function () {
  const response = http.get(`${baseUrl}/v1/public/bootstrap`);
  check(response, {
    'bootstrap returns 200': (result) => result.status === 200,
    'tenant cache is used': (result) => ['HIT', 'MISS'].includes(result.headers['X-Tenant-Cache']),
  });
}
