import { NextResponse } from 'next/server';
import { enrichPosts } from '../../../lib/scoring';

const API = 'https://graph.threads.net';

const demoPosts = (username) => enrichPosts([
  { id: 'demo-1', username, text: 'Most freelancers do not need another skill. They need proof that makes the skill easy to buy.', timestamp: '2026-09-06T06:30:00Z', permalink: 'https://www.threads.com', likes: 1840, replies: 218, reposts: 331, quotes: 91, views: null },
  { id: 'demo-2', username, text: 'Your portfolio is not a gallery. It is a sales argument.', timestamp: '2026-09-04T11:00:00Z', permalink: 'https://www.threads.com', likes: 730, replies: 61, reposts: 82, quotes: 24, views: null },
  { id: 'demo-3', username, text: 'I wasted months changing my Upwork profile when the real problem was the offer.', timestamp: '2026-09-02T04:10:00Z', permalink: 'https://www.threads.com', likes: 3620, replies: 447, reposts: 615, quotes: 140, views: null },
  { id: 'demo-4', username, text: 'Three things I would fix before sending another proposal.', timestamp: '2026-08-31T09:00:00Z', permalink: 'https://www.threads.com', likes: 520, replies: 73, reposts: 95, quotes: 18, views: null },
  { id: 'demo-5', username, text: 'A client paying $300 is not always worse than a client paying $1,000.', timestamp: '2026-08-28T14:40:00Z', permalink: 'https://www.threads.com', likes: 910, replies: 189, reposts: 74, quotes: 66, views: null }
]);

async function threadsFetch(path, params, token) {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { cache: 'no-store' });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message || 'Threads API request failed');
  return json;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const username = (searchParams.get('username') || '').replace(/^@/, '').trim();
  const demo = searchParams.get('demo') === '1';
  const token = process.env.THREADS_ACCESS_TOKEN;

  if (!username) return NextResponse.json({ error: 'Username is required.' }, { status: 400 });

  if (demo || !token) {
    return NextResponse.json({
      mode: 'demo',
      profile: { username, name: username, threads_biography: 'Demo data — add THREADS_ACCESS_TOKEN for live mode.' },
      posts: demoPosts(username)
    });
  }

  try {
    const profile = await threadsFetch('/profile_lookup', {
      username,
      fields: 'id,username,name,threads_profile_picture_url,threads_biography,is_verified'
    }, token);

    const feed = await threadsFetch('/profile_posts', {
      username,
      fields: 'id,media_type,permalink,username,text,timestamp,shortcode,is_quote_post,has_replies',
      limit: '100'
    }, token);

    // Public profile_posts does not expose private insights for arbitrary competitors.
    // Keep counters nullable; the UI and storage layer are already designed for richer
    // metrics when a compliant public-data source or authorized insights source is added.
    const posts = (feed.data || []).map((p) => ({
      ...p,
      likes: p.likes ?? null,
      replies: p.replies ?? null,
      reposts: p.reposts ?? null,
      quotes: p.quotes ?? null,
      views: p.views ?? null
    }));

    return NextResponse.json({ mode: 'live', profile, posts: enrichPosts(posts) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
