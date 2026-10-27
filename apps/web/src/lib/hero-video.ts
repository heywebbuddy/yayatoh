/**
 * The hero background video of an event page: a YouTube or Vimeo link the organizer pasted, turned
 * into a muted, looping, control-free embed on a privacy-friendly domain. Only these two origins are
 * ever embedded (the public CSP lists them under `frame-src`).
 *
 * Batch 2's video sections parse the same links (`parseVideoUrl` in the events module); once both
 * branches are merged this file should call that helper instead of keeping its own copy.
 */
export type HeroVideoRef = { provider: 'youtube' | 'vimeo'; id: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;

export function parseHeroVideo(raw: string | null | undefined): HeroVideoRef | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.split('/')[1] ?? '';
    return YT_ID.test(id) ? { provider: 'youtube', id } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const id =
      parts[0] === 'watch'
        ? (u.searchParams.get('v') ?? '')
        : parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live'
          ? (parts[1] ?? '')
          : '';
    return YT_ID.test(id) ? { provider: 'youtube', id } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id =
      u.pathname
        .split('/')
        .filter(Boolean)
        .find((p) => /^\d+$/.test(p)) ?? '';
    return VIMEO_ID.test(id) ? { provider: 'vimeo', id } : null;
  }
  return null;
}

/** The iframe `src` for the background: autoplaying, muted, looping, without controls. */
export function heroVideoSrc(ref: HeroVideoRef): string {
  return ref.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${ref.id}?autoplay=1&mute=1&loop=1&playlist=${ref.id}&controls=0&modestbranding=1&playsinline=1&rel=0&disablekb=1`
    : `https://player.vimeo.com/video/${ref.id}?background=1&autoplay=1&muted=1&loop=1&dnt=1`;
}

/** Origins the public page needs in `frame-src` to play the background. */
export const HERO_VIDEO_FRAME_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
] as const;
