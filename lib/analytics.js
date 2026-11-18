'use strict';

function createAnalytics(store) {
  const EMPTY = {
    daily: {},
    weekly: {},
    monthly: {},
    yearly: {},
    allTime: { requests: 0, tokens: 0, totalLatency: 0, byKey: {} },
  };

  // Serverless hosts keep accurate UTC clocks; no internet time sync needed.
  async function syncTime() {}

  function nowDate() {
    return new Date();
  }

  function read() {
    return store.get('analytics', EMPTY);
  }

  function recordRequestMetric(metric) {
    try {
      const now = nowDate();
      const day = now.toISOString().slice(0, 10);
      const month = now.toISOString().slice(0, 7);
      const year = String(now.getUTCFullYear());
      const oneJan = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
      const week = now.getUTCFullYear() + '-W' + Math.ceil((now.getUTCDay() + 1 + numberOfDays) / 7);

      const analytics = JSON.parse(JSON.stringify(read()));
      for (const k of ['daily', 'weekly', 'monthly', 'yearly']) if (!analytics[k]) analytics[k] = {};
      if (!analytics.allTime) analytics.allTime = { requests: 0, tokens: 0, totalLatency: 0, byKey: {} };
      // Keep the store small: drop daily buckets older than ~120 days.
      const dayKeys = Object.keys(analytics.daily).sort();
      while (dayKeys.length > 120) delete analytics.daily[dayKeys.shift()];

      const updateBucket = (bucket, key) => {
        if (!bucket[key]) {
          bucket[key] = { requests: 0, tokens: 0, totalLatency: 0, byKey: {} };
        }
        bucket[key].requests += 1;
        bucket[key].tokens += metric.tokens || 0;
        bucket[key].totalLatency += metric.latency || 0;
        if (metric.keyId) {
          if (!bucket[key].byKey) bucket[key].byKey = {};
          if (!bucket[key].byKey[metric.keyId]) {
            bucket[key].byKey[metric.keyId] = { requests: 0, tokens: 0 };
          }
          bucket[key].byKey[metric.keyId].requests += 1;
          bucket[key].byKey[metric.keyId].tokens += metric.tokens || 0;
        }
      };

      updateBucket(analytics.daily, day);
      updateBucket(analytics.weekly, week);
      updateBucket(analytics.monthly, month);
      updateBucket(analytics.yearly, year);

      analytics.allTime.requests += 1;
      analytics.allTime.tokens += metric.tokens || 0;
      analytics.allTime.totalLatency += metric.latency || 0;
      if (metric.keyId) {
        if (!analytics.allTime.byKey) analytics.allTime.byKey = {};
        if (!analytics.allTime.byKey[metric.keyId]) {
          analytics.allTime.byKey[metric.keyId] = { requests: 0, tokens: 0 };
        }
        analytics.allTime.byKey[metric.keyId].requests += 1;
        analytics.allTime.byKey[metric.keyId].tokens += metric.tokens || 0;
      }

      store.set('analytics', analytics);
    } catch (_) {
      /* analytics must never break a request */
    }
  }

  return { read, recordRequestMetric, syncTime };
}

module.exports = { createAnalytics };
