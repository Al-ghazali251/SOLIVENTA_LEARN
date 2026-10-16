const target = process.env.STAGING_BOOTSTRAP_URL;
if (!target) throw new Error('STAGING_BOOTSTRAP_URL is required.');
const samples = Number(process.env.BOOTSTRAP_LATENCY_SAMPLES ?? 10);
const maximumP95 = Number(process.env.BOOTSTRAP_MAX_P95_MS ?? 500);
const durations = [];

for (let index = 0; index < samples; index += 1) {
  const started = performance.now();
  const response = await fetch(target, { headers: { Accept: 'application/json' } });
  const elapsed = performance.now() - started;
  if (!response.ok) throw new Error(`Bootstrap probe failed with ${response.status}.`);
  durations.push(elapsed);
}

durations.sort((left, right) => left - right);
const percentile = (value) =>
  durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)];
const median = percentile(0.5);
const p95 = percentile(0.95);
console.log(
  JSON.stringify({
    target: new URL(target).hostname,
    samples,
    medianMs: Number(median.toFixed(1)),
    p95Ms: Number(p95.toFixed(1)),
    maximumP95Ms: maximumP95,
  }),
);
if (p95 > maximumP95) throw new Error(`Bootstrap p95 ${p95.toFixed(1)}ms exceeds ${maximumP95}ms.`);
