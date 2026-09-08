const WEIGHTS = {
  likes: 1,
  replies: 3,
  reposts: 4,
  quotes: 4,
};

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function hasEngagementMetrics(post) {
  return Object.keys(WEIGHTS).every((key) => isNumber(post?.[key]));
}

export function weightedEngagement(post) {
  if (!hasEngagementMetrics(post)) return null;

  return Object.entries(WEIGHTS).reduce(
    (total, [key, weight]) => total + post[key] * weight,
    0
  );
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function enrichPosts(posts = []) {
  const engagements = posts
    .map(weightedEngagement)
    .filter((value) => value !== null);

  // A 1–2 post baseline is too unstable to label something an outlier.
  const baseline = engagements.length >= 3 ? median(engagements) : null;
  const safeBaseline = baseline !== null ? Math.max(baseline, 1) : null;

  return posts.map((post) => {
    const engagement = weightedEngagement(post);
    const viralIndex =
      engagement !== null && safeBaseline !== null
        ? Number((engagement / safeBaseline).toFixed(2))
        : null;

    return {
      ...post,
      engagement,
      viralIndex,
      hasMetrics: engagement !== null,
    };
  });
}
