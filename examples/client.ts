export interface MirrorList {
  version: 1;
  updated_at: string;
  domains: string[]; // ordered by priority, [0] = primary
}

const REPO = 'your-org/mirrors';
const BRANCH = 'main';

// Same file, three independent hosts: blocking one doesn't cut clients off from the list.
const SOURCES: { url: string; headers?: Record<string, string> }[] = [
  { url: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/domains.json` },
  { url: `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/domains.json` },
  {
    // 60 req/h per IP without a token — fine as a last resort, not as the primary.
    url: `https://api.github.com/repos/${REPO}/contents/domains.json?ref=${BRANCH}`,
    headers: { Accept: 'application/vnd.github.raw+json' },
  },
];

const CACHE_KEY = 'mirrors';
const FALLBACK: MirrorList = {
  version: 1,
  updated_at: '1970-01-01T00:00:00Z',
  domains: ['example.com'],
};

async function fetchList({ url, headers }: (typeof SOURCES)[number]): Promise<MirrorList> {
  const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const data = (await res.json()) as MirrorList;
  if (data.version !== 1 || !Array.isArray(data.domains) || data.domains.length === 0)
    throw new Error(`${url}: bad contract`);
  return data;
}

function readCache(): MirrorList | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export async function loadMirrors(): Promise<MirrorList> {
  const cached = readCache();
  try {
    const fresh = await Promise.any(SOURCES.map(fetchList));
    // Never downgrade to an older list: protects against a stale CDN copy.
    if (!cached || Date.parse(fresh.updated_at) >= Date.parse(cached.updated_at)) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
      } catch {}
      return fresh;
    }
    return cached;
  } catch {
    return cached ?? FALLBACK;
  }
}

// no-cors: we only care whether TLS + HTTP completed. A DNS/IP block or an ISP stub page
// fails the TLS handshake, so fetch rejects; an opaque response means the host is alive.
async function isReachable(host: string): Promise<boolean> {
  try {
    await fetch(`https://${host}/favicon.ico`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

export async function resolveHost(): Promise<string | null> {
  const { domains } = await loadMirrors();
  for (const host of domains) if (await isReachable(host)) return host;
  return null;
}
