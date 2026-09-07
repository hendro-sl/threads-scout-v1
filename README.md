# Threads Scout V1

A zero-cost, cloud-deployable Threads research MVP.

## What it does
- Search a public Threads username.
- Retrieve public profile + public profile posts through the official Threads API.
- Rank posts by a configurable weighted engagement score / Viral Index when metrics are present.
- Sort/search posts.
- Cache research in the browser (`localStorage`) — no paid database required.
- Demo mode works without credentials.

## Zero-cost architecture
- Next.js
- Vercel Hobby for personal/non-commercial use
- Browser localStorage for saved research
- Official Meta Threads API
- No Supabase, paid DB, domain, or AI API required

## Local run
```bash
npm install
cp .env.example .env.local
# add THREADS_ACCESS_TOKEN if available
npm run dev
```
Then open http://localhost:3000

## Deploy to Vercel
1. Push this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Add Environment Variable:
   - `THREADS_ACCESS_TOKEN` = your Threads User Access Token
4. Deploy.

Without a token the app automatically returns demo data, so deployment can be tested immediately.

## Meta setup needed for live data
The official Threads API uses OAuth 2.0. Create/configure a Meta app with Threads API access, authorize the app, then obtain a Threads User Access Token. Public profile lookup and profile-post retrieval still require authorization.

## Important limitation
Public post retrieval and private Insights are different API capabilities. Metrics that Meta does not expose for arbitrary public competitor posts are intentionally represented as unavailable; this app does not fabricate view/save counts.

## Next V2
Recommended next additions:
1. OAuth login/token refresh instead of a manually set token.
2. IndexedDB instead of localStorage for large datasets.
3. Multi-account watchlist.
4. Snapshots to track growth over time.
5. CSV export.
6. Optional free AI via local/browser model or BYO API key.
