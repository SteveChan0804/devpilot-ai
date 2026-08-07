type MetricState = { count: number; total: number; max: number };

const startedAt = new Date().toISOString();
const metrics = new Map<string, MetricState>();
let activeRequests = 0;

export function recordMetric(name: string, value = 1) {
  const current = metrics.get(name) ?? { count: 0, total: 0, max: 0 };
  current.count++;
  current.total += value;
  current.max = Math.max(current.max, value);
  metrics.set(name, current);
}

export function requestStarted() { activeRequests++; }
export function requestFinished(statusCode: number, durationMs: number) {
  activeRequests = Math.max(0, activeRequests - 1);
  recordMetric(`http.status.${statusCode}`, 1);
  recordMetric("http.duration_ms", durationMs);
}

export function metricsSnapshot() {
  return {
    startedAt,
    activeRequests,
    metrics: Object.fromEntries([...metrics.entries()].map(([name, value]) => [name, { ...value, average: value.count ? value.total / value.count : 0 }])),
  };
}
