import { parseVideoUrl, videoEmbedUrl } from '@yayatoh/events/ui';

/**
 * A YouTube or Vimeo video in a 16:9 frame, on the privacy-friendly embed domains (the public CSP
 * allows exactly those in `frame-src`). Renders nothing for any other link.
 */
export function VideoEmbed({ url, title }: { url: string; title: string }) {
  const ref = parseVideoUrl(url);
  if (!ref) return null;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-card border border-line bg-surface-3">
      <iframe
        src={videoEmbedUrl(ref)}
        title={title}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        className="absolute inset-0 size-full border-0"
      />
    </div>
  );
}
