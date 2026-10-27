/** A video the organizer pasted as a link: only YouTube and Vimeo are embedded (privacy-friendly origins). */
export type VideoRef = { provider: 'youtube' | 'vimeo'; id: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;

export function parseVideoUrl(raw: string): VideoRef | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
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

/** The iframe `src` for a video: YouTube's no-cookie domain, Vimeo with do-not-track. */
export function videoEmbedUrl(ref: VideoRef): string {
  return ref.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${ref.id}`
    : `https://player.vimeo.com/video/${ref.id}?dnt=1`;
}

/** Origins a page needs in `frame-src` to play the embeds above. */
export const VIDEO_FRAME_ORIGINS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'] as const;

/**
 * A video the organizer uploaded to our own storage, as stored in a design or a section: the app's
 * own `/video/{org}/{id}/v-{hash}.mp4|webm` path (and `p-{hash}.jpg|png|webp` for its poster).
 */
const UPLOADED =
  '/video/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';
export const UPLOADED_VIDEO_PATH = new RegExp(`^${UPLOADED}v-[0-9a-f]{32}\\.(mp4|webm)$`);
export const UPLOADED_POSTER_PATH = new RegExp(`^${UPLOADED}p-[0-9a-f]{32}\\.(jpg|png|webp)$`);
export const isUploadedVideo = (v: string | null | undefined): v is string =>
  typeof v === 'string' && UPLOADED_VIDEO_PATH.test(v);
export const isUploadedPoster = (v: string | null | undefined): v is string =>
  typeof v === 'string' && UPLOADED_POSTER_PATH.test(v);
