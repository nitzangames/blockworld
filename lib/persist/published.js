// Public world gallery client. These endpoints are public (no auth); the SDK is only needed for
// publishing. The deployed game's CSP allows connect-src https://nitzan.games.
const API = 'https://nitzan.games';

export async function listPublished(slug = 'blockworld') {
  try {
    const r = await fetch(`${API}/api/worlds?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.worlds) ? data.worlds : [];
  } catch { return []; }
}

export async function getPublished(publishId) {
  try {
    const r = await fetch(`${API}/api/worlds/${encodeURIComponent(publishId)}`);
    if (!r.ok) return null;            // 404 -> went private / missing
    return await r.json();             // { publish_id, title, creator_name, copyable, blob }
  } catch { return null; }
}
