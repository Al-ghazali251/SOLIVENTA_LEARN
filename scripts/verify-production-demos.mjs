import { readFile } from 'node:fs/promises';
const manifest=JSON.parse(await readFile('ops/production/demo-tenants.json','utf8'));
const checks=[];
for(const tenant of manifest.tenants)checks.push([`https://${tenant.publicHostname}/`,tenant.name],[`https://${tenant.publicHostname}/api/v1/public/bootstrap`,tenant.name],[`https://${tenant.portalHostname}/`,null],[`https://${tenant.portalHostname}/api/v1/public/bootstrap`,tenant.name]);
checks.push([`https://${manifest.apiHostname}/health/live`,'ok']);
for(const [url,expected] of checks){const response=await fetch(url,{redirect:'manual'});if(!response.ok)throw new Error(`${url} returned ${response.status}`);const body=await response.text();if(expected&&!body.toLowerCase().includes(expected.toLowerCase()))throw new Error(`${url} did not identify ${expected}`);console.log(`OK ${response.status} ${url}`);}
