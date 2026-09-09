'use client';

import { useEffect, useMemo, useState } from 'react';

const STORE_KEY = 'threads-scout-cache-v2';
const CACHE_VERSION = 2;
const MAX_CACHE_ITEMS = 12;
const num = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function metric(value) {
  return value === null || value === undefined ? '—' : num.format(value);
}

function cleanUsername(value = '') {
  return String(value).replace(/^@/, '').trim();
}

function normalizeError(data, fallback = 'Failed to load this account.') {
  if (data?.error && typeof data.error === 'object') {
    return {
      ...data.error,
      diagnostics: data.diagnostics || null,
    };
  }

  return {
    code: 'REQUEST_FAILED',
    title: 'Could not load this account',
    message:
      typeof data?.error === 'string' ? data.error : fallback,
    action: 'Retry the request. If it continues, keep the error code and Request ID for diagnosis.',
    retryable: true,
    requestId: data?.requestId || null,
    diagnostics: data?.diagnostics || null,
  };
}

function accountLabel(result) {
  const type = result?.capabilities?.accountType;
  const metrics = result?.capabilities?.postMetrics;

  if (type === 'demo') return 'Demo data';
  if (type === 'public') return 'Public account · Content only';
  if (type === 'own' && metrics === 'full') {
    return 'Own account · Insights available';
  }
  if (type === 'own' && metrics === 'partial') {
    return 'Own account · Partial insights';
  }
  if (type === 'own') return 'Own account · Content only';
  return result?.mode === 'demo-no-token' ? 'Demo · Token missing' : 'Live API';
}

function ErrorCard({ error, onRetry }) {
  if (!error) return null;

  return (
    <div className="error-card" role="alert">
      <div className="error-topline">
        <span className="error-code">{error.code || 'ERROR'}</span>
        {error.retryable && <span className="retryable">Safe to retry</span>}
      </div>
      <strong>{error.title || 'Something went wrong'}</strong>
      <p>{error.message}</p>
      {error.action && <div className="error-action">Next: {error.action}</div>}
      <div className="error-footer">
        {onRetry && (
          <button className="secondary-button" onClick={onRetry}>
            Retry
          </button>
        )}
        {error.requestId && (
          <span className="request-id">Request ID: {error.requestId}</span>
        )}
      </div>
      {error.diagnostics && (
        <details>
          <summary>Diagnostics</summary>
          <pre>{JSON.stringify(error.diagnostics, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export default function Home() {
  const [username, setUsername] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('timestamp');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState({});
  const [cacheMeta, setCacheMeta] = useState(null);
  const [lastRequest, setLastRequest] = useState(null);
  const [auth, setAuth] = useState({ loading: true, connected: false, source: 'none', scopesKnown: false, discoveryReady: null, insightsReady: null });
  const [authNotice, setAuthNotice] = useState(null);



  async function loadAuthStatus() {
    try {
      const response = await fetch('/api/auth/threads/status', { cache: 'no-store' });
      const data = await response.json();
      setAuth({ loading: false, ...data });
    } catch {
      setAuth({ loading: false, connected: false, source: 'unknown', scopesKnown: false, discoveryReady: null });
    }
  }

  useEffect(() => {
    loadAuthStatus();
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    const oauthError = params.get('oauth_error');
    if (oauth === 'connected') {
      setAuthNotice({ type: 'success', message: 'Threads connected. Permission status is being verified.' });
    } else if (oauthError) {
      const messages = {
        config_missing: 'OAuth configuration is incomplete in Vercel.',
        authorization_denied: 'Threads authorization was cancelled or denied.',
        state_mismatch: 'OAuth security check failed. Start Connect Threads again.',
        token_exchange_failed: 'Meta returned to the app, but the token exchange failed. Check the OAuth configuration before retrying.',
      };
      setAuthNotice({ type: 'error', message: messages[oauthError] || 'Threads connection failed.' });
    }
    if (oauth || oauthError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function disconnectThreads() {
    await fetch('/api/auth/threads/disconnect', { method: 'POST' });
    setAuthNotice({ type: 'success', message: 'Browser OAuth session disconnected. The legacy Vercel token, if present, is unchanged.' });
    await loadAuthStatus();
  }

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (parsed && typeof parsed === 'object') setSaved(parsed);
    } catch {
      localStorage.removeItem(STORE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!result) return;
    if (result?.capabilities?.viralRanking) setSortBy('viralIndex');
    else setSortBy('timestamp');
  }, [result?.requestId, result?.mode]);

  function persistResult(name, data) {
    const key = name.toLowerCase();
    const entry = {
      version: CACHE_VERSION,
      username: name,
      cachedAt: new Date().toISOString(),
      data,
    };

    const next = { ...saved, [key]: entry };
    const orderedKeys = Object.keys(next).sort(
      (a, b) =>
        new Date(next[b]?.cachedAt || 0) - new Date(next[a]?.cachedAt || 0)
    );

    const trimmed = Object.fromEntries(
      orderedKeys.slice(0, MAX_CACHE_ITEMS).map((item) => [item, next[item]])
    );

    setSaved(trimmed);
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  }

  async function search(options = {}) {
    const forceDemo = Boolean(options.forceDemo);
    const clean = cleanUsername(options.username || username || '');

    if (!clean && !forceDemo) {
      setError({
        code: 'USERNAME_REQUIRED',
        title: 'Enter a Threads username',
        message: 'Threads Scout needs the exact account username to start research.',
        action: 'Type the username without @, then click Analyze account.',
        retryable: false,
      });
      return;
    }

    const target = clean || 'demo_creator';

    const ownUsername = auth?.profile?.username?.toLowerCase();
    const isKnownPublicTarget =
      !forceDemo &&
      ownUsername &&
      target.toLowerCase() !== ownUsername;

    if (isKnownPublicTarget && auth.scopesKnown && auth.discoveryReady === false) {
      setError({
        code: 'PROFILE_DISCOVERY_MISSING',
        title: 'Public-account permission is missing',
        message: 'This token does not include threads_profile_discovery, so Meta will reject public-account research.',
        action: 'Click Connect / Reconnect Threads and approve the requested permissions. Do not change code or Vercel tokens.',
        retryable: false,
      });
      return;
    }

    setUsername(target);
    setLoading(true);
    setError(null);
    setResult(null);
    setCacheMeta(null);
    setQuery('');
    setLastRequest({ username: target, forceDemo });

    try {
      const params = new URLSearchParams({ username: target });
      if (forceDemo) params.set('demo', '1');

      const response = await fetch(`/api/threads?${params.toString()}`, {
        cache: 'no-store',
      });

      const text = await response.text();
      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw {
          code: 'INVALID_SERVER_RESPONSE',
          title: 'Invalid server response',
          message: 'The app server returned data that Threads Scout could not read.',
          action: 'Retry once. If it continues, inspect the latest Vercel deployment logs.',
          retryable: true,
        };
      }

      if (!response.ok || data?.ok === false) {
        throw normalizeError(data);
      }

      setResult(data);
      persistResult(target, data);
    } catch (caught) {
      if (caught?.code && caught?.title) {
        setError(caught);
      } else {
        setError({
          code: 'BROWSER_NETWORK_ERROR',
          title: 'Could not reach Threads Scout',
          message: caught?.message || 'The browser request failed.',
          action: 'Check your connection and use Retry.',
          retryable: true,
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function retryLast() {
    if (!lastRequest) return;
    search(lastRequest);
  }

  function loadCached(key) {
    const entry = saved[key];
    if (!entry?.data) return;
    setUsername(entry.username || key);
    setResult(entry.data);
    setError(null);
    setCacheMeta({ cachedAt: entry.cachedAt });
    setLastRequest({ username: entry.username || key, forceDemo: false });
    setQuery('');
  }

  function removeCached(key, event) {
    event.stopPropagation();
    const next = { ...saved };
    delete next[key];
    setSaved(next);
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  }

  const capabilities = result?.capabilities || {};
  const metricsAvailable =
    capabilities.postMetrics === 'full' || capabilities.postMetrics === 'partial';
  const canRank = capabilities.viralRanking === true;
  const isPublic = capabilities.accountType === 'public';

  const sortOptions = useMemo(() => {
    const options = [];
    if (canRank) {
      options.push(['viralIndex', 'Viral index']);
      options.push(['engagement', 'Weighted engagement']);
    }
    if (metricsAvailable) {
      options.push(['likes', 'Likes']);
      options.push(['replies', 'Replies']);
      options.push(['reposts', 'Reposts']);
      options.push(['quotes', 'Quotes']);
      options.push(['views', 'Views']);
    }
    options.push(['timestamp', 'Newest']);
    return options;
  }, [canRank, metricsAvailable]);

  const posts = useMemo(() => {
    if (!result?.posts) return [];

    return [...result.posts]
      .filter(
        (post) =>
          !query ||
          (post.text || '').toLowerCase().includes(query.toLowerCase())
      )
      .sort((a, b) => {
        if (sortBy === 'timestamp') {
          return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
        }

        const aValue = a?.[sortBy];
        const bValue = b?.[sortBy];
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        return Number(bValue) - Number(aValue);
      });
  }, [result, sortBy, query]);

  const outliers = canRank
    ? posts.filter((post) => Number(post.viralIndex) >= 2).length
    : null;

  const recentEntries = Object.entries(saved).sort(
    (a, b) =>
      new Date(b[1]?.cachedAt || 0) - new Date(a[1]?.cachedAt || 0)
  );

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">THREADS CONTENT INTELLIGENCE · V1.2</div>
        <h1>
          Research posts without <span>fake metrics.</span>
        </h1>
        <p>
          Search a Threads account, inspect public content, and rank your own posts
          when official Insights are available.
        </p>

        <section className="auth-panel" aria-live="polite">
          <div className="auth-copy">
            <small>THREADS CONNECTION</small>
            {auth.loading ? (
              <strong>Checking connection…</strong>
            ) : auth.connected ? (
              <>
                <strong>Connected{auth.profile?.username ? ` as @${auth.profile.username}` : ''}</strong>
                <span>
                  {auth.source === 'oauth' ? 'OAuth session' : 'Legacy Vercel token'}
                  {' · '}
                  {auth.scopesKnown
                    ? auth.discoveryReady
                      ? 'Public profile discovery ready'
                      : 'Public profile discovery missing'
                    : 'Permission list unavailable'}
                </span>
              </>
            ) : (
              <>
                <strong>Threads is not connected</strong>
                <span>Connect through Meta OAuth so the app can request the exact research permissions.</span>
              </>
            )}
          </div>
          <div className="auth-actions">
            <a className="connect-button" href="/api/auth/threads/start">
              {auth.connected ? 'Reconnect Threads' : 'Connect Threads'}
            </a>
            {auth.source === 'oauth' && (
              <button className="auth-disconnect" onClick={disconnectThreads}>Disconnect</button>
            )}
          </div>
        </section>

        {authNotice && (
          <div className={`auth-notice ${authNotice.type === 'error' ? 'auth-notice-error' : ''}`}>
            {authNotice.message}
          </div>
        )}

        <div className="searchbox">
          <span>@</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            aria-label="Threads username"
          />
          <button onClick={() => search()} disabled={loading}>
            {loading ? 'Scanning…' : 'Analyze account'}
          </button>
        </div>

        <button
          className="demo"
          onClick={() => search({ forceDemo: true, username: username || 'demo_creator' })}
          disabled={loading}
        >
          Try demo data
        </button>

        <ErrorCard error={error} onRetry={lastRequest ? retryLast : null} />
      </section>

      {recentEntries.length > 0 && (
        <section className="recent panel">
          <div className="section-heading-row">
            <div>
              <div className="section-title">Recent research</div>
              <div className="muted">Stored only in this browser.</div>
            </div>
          </div>
          <div className="chips">
            {recentEntries.map(([key, entry]) => (
              <div className="chip-wrap" key={key}>
                <button className="chip-main" onClick={() => loadCached(key)}>
                  @{entry?.username || key}
                </button>
                <button
                  className="chip-remove"
                  onClick={(event) => removeCached(key, event)}
                  aria-label={`Remove ${entry?.username || key} from recent research`}
                  title="Remove cached research"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {result && (
        <>
          <section className="status-row">
            <div className={`status-pill status-${capabilities.accountType || 'live'}`}>
              {accountLabel(result)}
            </div>
            {cacheMeta?.cachedAt && (
              <div className="cache-label">
                Cached {new Date(cacheMeta.cachedAt).toLocaleString()}
              </div>
            )}
          </section>

          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <section className="warning-stack">
              {result.warnings.map((warning, index) => (
                <div className="warning-card" key={`${warning.code}-${index}`}>
                  <strong>{warning.code}</strong>
                  <span>{warning.message}</span>
                  {warning.action && <small>{warning.action}</small>}
                </div>
              ))}
            </section>
          )}

          <section className="stats">
            <div className="stat">
              <small>ACCOUNT</small>
              <strong>@{result.profile?.username || username}</strong>
              <span>{accountLabel(result)}</span>
            </div>
            <div className="stat">
              <small>POSTS</small>
              <strong>{result.posts?.length || 0}</strong>
              <span>loaded</span>
            </div>
            <div className="stat">
              <small>{canRank ? 'OUTLIERS' : 'RESEARCH MODE'}</small>
              <strong>{canRank ? outliers : 'Content'}</strong>
              <span>{canRank ? '≥ 2× account baseline' : 'metrics not assumed'}</span>
            </div>
            <div className="stat">
              <small>STORAGE</small>
              <strong>Local</strong>
              <span>this browser</span>
            </div>
          </section>

          {isPublic && (
            <section className="info-card">
              <strong>Public account research</strong>
              <p>
                Threads Scout can research the returned post content, dates, media
                types and links. It does not invent competitor views, likes or a
                viral score when owner Insights are unavailable.
              </p>
            </section>
          )}

          <section className="panel table-panel">
            <div className="toolbar">
              <div>
                <div className="section-title">
                  {canRank ? 'Performance ranking' : 'Content research'}
                </div>
                <div className="muted">
                  {canRank
                    ? 'Ranking uses only posts with real engagement metrics.'
                    : 'Browse and search the content Meta returned for this account.'}
                </div>
              </div>
              <div className="controls">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search post text…"
                  aria-label="Search post text"
                />
                <select
                  value={sortOptions.some(([value]) => value === sortBy) ? sortBy : 'timestamp'}
                  onChange={(event) => setSortBy(event.target.value)}
                  aria-label="Sort posts"
                >
                  {sortOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table-wrap">
              <table className={metricsAvailable ? 'metrics-table' : 'content-table'}>
                <thead>
                  <tr>
                    <th>Post</th>
                    <th>Date</th>
                    <th>Type</th>
                    {metricsAvailable && <th>Likes</th>}
                    {metricsAvailable && <th>Replies</th>}
                    {metricsAvailable && <th>Reposts</th>}
                    {metricsAvailable && <th>Quotes</th>}
                    {metricsAvailable && <th>Views</th>}
                    {canRank && <th>Viral</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr key={post.id}>
                      <td className="postcell">
                        <div>{post.text || '(media post)'}</div>
                        <small>@{post.username || result.profile?.username}</small>
                      </td>
                      <td>
                        {post.timestamp
                          ? new Date(post.timestamp).toLocaleDateString()
                          : '—'}
                      </td>
                      <td>{post.media_type || '—'}</td>
                      {metricsAvailable && <td>{metric(post.likes)}</td>}
                      {metricsAvailable && <td>{metric(post.replies)}</td>}
                      {metricsAvailable && <td>{metric(post.reposts)}</td>}
                      {metricsAvailable && <td>{metric(post.quotes)}</td>}
                      {metricsAvailable && <td>{metric(post.views)}</td>}
                      {canRank && (
                        <td>
                          <span
                            className={`badge ${
                              Number(post.viralIndex) >= 2 ? 'hot' : ''
                            }`}
                          >
                            {post.viralIndex !== null && post.viralIndex !== undefined
                              ? `${post.viralIndex}×`
                              : '—'}
                          </span>
                        </td>
                      )}
                      <td>
                        {post.permalink && (
                          <a href={post.permalink} target="_blank" rel="noreferrer">
                            Open ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!posts.length && (
              <div className="empty">
                {query
                  ? 'No posts match this text filter.'
                  : 'Threads returned no posts for this account.'}
              </div>
            )}
          </section>

          <section className="note">
            <strong>Data integrity rule</strong>
            <p>
              Missing metrics stay unavailable. Threads Scout never converts missing
              competitor data into zero and never generates a viral score from absent
              engagement data.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
