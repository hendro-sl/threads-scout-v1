'use client';

import { useEffect, useMemo, useState } from 'react';

const STORE_KEY = 'threads-scout-cache-v1';
const num = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function metric(v) {
  return v === null || v === undefined ? '—' : num.format(v);
}

export default function Home() {
  const [username, setUsername] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('viralIndex');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState({});

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      setSaved(parsed);
    } catch {}
  }, []);

  function persist(next) {
    setSaved(next);
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  }

  async function search(forceDemo = false, overrideUsername = '') {
    const clean = (overrideUsername || username).replace(/^@/, '').trim();
    if (!clean) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/threads?username=${encodeURIComponent(clean)}${forceDemo ? '&demo=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load account');
      setResult(data);
      persist({ ...saved, [clean]: { ...data, cachedAt: new Date().toISOString() } });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function loadCached(name) {
    setUsername(name);
    setResult(saved[name]);
  }

  const posts = useMemo(() => {
    if (!result?.posts) return [];
    return [...result.posts]
      .filter((p) => !query || (p.text || '').toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'timestamp') return new Date(b.timestamp) - new Date(a.timestamp);
        return Number(b[sortBy] ?? -1) - Number(a[sortBy] ?? -1);
      });
  }, [result, sortBy, query]);

  const outliers = posts.filter((p) => Number(p.viralIndex || 0) >= 2).length;

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">THREADS CONTENT INTELLIGENCE</div>
        <h1>Find the posts that <span>break the baseline.</span></h1>
        <p>Search a public Threads username, rank posts, spot outliers, and keep the research in your own browser.</p>
        <div className="searchbox">
          <span>@</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(false)} placeholder="username" />
          <button onClick={() => search(false)} disabled={loading}>{loading ? 'Scanning…' : 'Analyze account'}</button>
        </div>
        <button className="demo" onClick={() => { const name = username || 'demo_creator'; setUsername(name); search(true, name); }}>Try demo data</button>
        {error && <div className="error">{error}</div>}
      </section>

      {Object.keys(saved).length > 0 && (
        <section className="recent panel">
          <div className="section-title">Recent research</div>
          <div className="chips">{Object.keys(saved).slice(-8).reverse().map((name) => <button key={name} onClick={() => loadCached(name)}>@{name}</button>)}</div>
        </section>
      )}

      {result && (
        <>
          <section className="stats">
            <div className="stat"><small>ACCOUNT</small><strong>@{result.profile?.username}</strong><span>{result.mode === 'demo' ? 'Demo mode' : 'Live API'}</span></div>
            <div className="stat"><small>POSTS</small><strong>{result.posts.length}</strong><span>loaded</span></div>
            <div className="stat"><small>OUTLIERS</small><strong>{outliers}</strong><span>≥ 2× baseline</span></div>
            <div className="stat"><small>STORAGE</small><strong>Local</strong><span>this browser</span></div>
          </section>

          <section className="panel table-panel">
            <div className="toolbar">
              <div><div className="section-title">Top posts</div><div className="muted">Rank what actually stands out.</div></div>
              <div className="controls">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search post text…" />
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="viralIndex">Viral index</option><option value="engagement">Weighted engagement</option><option value="likes">Likes</option><option value="replies">Replies</option><option value="reposts">Reposts</option><option value="quotes">Quotes</option><option value="views">Views</option><option value="timestamp">Newest</option>
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table><thead><tr><th>Post</th><th>Likes</th><th>Replies</th><th>Reposts</th><th>Quotes</th><th>Views</th><th>Viral</th><th></th></tr></thead>
                <tbody>{posts.map((p) => <tr key={p.id}>
                  <td className="postcell"><div>{p.text || '(media post)'}</div><small>{new Date(p.timestamp).toLocaleDateString()} · @{p.username || result.profile?.username}</small></td>
                  <td>{metric(p.likes)}</td><td>{metric(p.replies)}</td><td>{metric(p.reposts)}</td><td>{metric(p.quotes)}</td><td>{metric(p.views)}</td>
                  <td><span className={`badge ${p.viralIndex >= 2 ? 'hot' : ''}`}>{p.viralIndex ? `${p.viralIndex}×` : '—'}</span></td>
                  <td>{p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer">Open ↗</a>}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {!posts.length && <div className="empty">No posts match this filter.</div>}
          </section>

          <section className="note">
            <strong>Metric note</strong>
            <p>Public profile retrieval is separate from private post insights. Unsupported competitor metrics stay blank instead of being estimated.</p>
          </section>
        </>
      )}
    </main>
  );
}
