export function weightedEngagement(post) {
  return (
    Number(post.likes || 0) +
    Number(post.replies || 0) * 3 +
    Number(post.reposts || 0) * 4 +
    Number(post.quotes || 0) * 4
  );
}

export function enrichPosts(posts) {
  const scores = posts.map(weightedEngagement).sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  const median = !scores.length
    ? 1
    : scores.length % 2
      ? scores[mid]
      : (scores[mid - 1] + scores[mid]) / 2;
  const safeMedian = Math.max(median, 1);

  return posts.map((post) => {
    const engagement = weightedEngagement(post);
    return {
      ...post,
      engagement,
      viralIndex: Number((engagement / safeMedian).toFixed(2))
    };
  });
}
