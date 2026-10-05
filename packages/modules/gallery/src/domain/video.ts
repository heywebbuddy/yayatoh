import type { VideoProvider } from '../schema.ts';

/**
 * Video links (M4.5b, P4-5): YouTube and Vimeo only. The link a person pastes is parsed to a
 * provider and an id and **never stored**: the gallery rebuilds a canonical https URL from the id,
 * so no tracking parameters, other hosts or `javascript:` ever reach a page.
 */
export interface VideoRef {
  readonly provider: VideoProvider;
  readonly videoId: string;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{1,12}$/;

export function parseVideoLink(raw: string): VideoRef | null {
  const text = raw.trim();
  if (!text || text.length > 500) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') {
    const id = parts[0] ?? '';
    return parts.length === 1 && YT_ID.test(id) ? { provider: 'youtube', videoId: id } : null;
  }
  if (YOUTUBE_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === 'watch') {
      const id = url.searchParams.get('v') ?? '';
      return YT_ID.test(id) ? { provider: 'youtube', videoId: id } : null;
    }
    if (parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0] ?? '')) {
      const id = parts[1] ?? '';
      return YT_ID.test(id) ? { provider: 'youtube', videoId: id } : null;
    }
    return null;
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    const id = parts[0] ?? '';
    return parts.length >= 1 && parts.length <= 2 && VIMEO_ID.test(id)
      ? { provider: 'vimeo', videoId: id }
      : null;
  }
  if (host === 'player.vimeo.com') {
    const id = parts[1] ?? '';
    return parts.length === 2 && parts[0] === 'video' && VIMEO_ID.test(id)
      ? { provider: 'vimeo', videoId: id }
      : null;
  }
  return null;
}

/** The canonical link for a stored video (built from the id, never from input). */
export function videoUrl(v: VideoRef): string {
  return v.provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`
    : `https://vimeo.com/${encodeURIComponent(v.videoId)}`;
}
