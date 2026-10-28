'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * The hero background video of an event page: a muted, looping embed that covers the hero, under a
 * dark scrim, with a pause button. The hero's cover image stays beneath it as the poster and
 * fallback: the video only mounts after hydration, never when the visitor prefers reduced motion
 * (they can still start it with the button), and pausing unmounts it, so the poster shows again.
 */
export function HeroVideo({
  src,
  title,
  playLabel,
  pauseLabel,
}: {
  src: string;
  /** What the video is, for assistive technology (the event's name). */
  title: string;
  playLabel: string;
  pauseLabel: string;
}) {
  // Rendered on the server too, so the player is in the page from the first byte; a visitor who
  // prefers reduced motion has it removed again right after hydration (the poster stays).
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);
  return (
    <>
      <div aria-hidden="true" className="[container-type:size] absolute inset-0 -z-10 overflow-hidden">
        {playing ? (
          <iframe
            src={src}
            title={title}
            tabIndex={-1}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            className="pointer-events-none absolute top-1/2 left-1/2 h-[max(100cqh,56.25cqw)] w-[max(100cqw,177.78cqh)] -translate-x-1/2 -translate-y-1/2 border-0"
          />
        ) : null}
        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/50 to-black/30" />
      </div>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? pauseLabel : playLabel}
        className="absolute end-4 top-4 z-10 inline-flex size-11 items-center justify-center rounded-pill border border-white/30 bg-black/50 text-white backdrop-blur hover:bg-black/70"
      >
        {playing ? (
          <Pause aria-hidden="true" className="size-5" />
        ) : (
          <Play aria-hidden="true" className="size-5" />
        )}
      </button>
    </>
  );
}

/**
 * The hero background when the organizer uploaded a video: a muted, looping, cover-fit `<video>`
 * from our own storage under the same scrim and pause button, with the uploaded poster showing
 * until it plays. Visitors who prefer reduced motion get the poster and a play button instead.
 */
export function HeroUploadedVideo({
  src,
  poster,
  playLabel,
  pauseLabel,
}: {
  src: string;
  poster: string | null;
  playLabel: string;
  pauseLabel: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setPlaying(false);
      ref.current?.pause();
    }
  }, []);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing]);
  return (
    <>
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
        {/* biome-ignore lint/a11y/useMediaCaption: a muted decorative background loop, no audio to caption */}
        <video
          ref={ref}
          src={src}
          poster={poster ?? undefined}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          tabIndex={-1}
          className="pointer-events-none size-full object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/50 to-black/30" />
      </div>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? pauseLabel : playLabel}
        className="absolute end-4 top-4 z-10 inline-flex size-11 items-center justify-center rounded-pill border border-white/30 bg-black/50 text-white backdrop-blur hover:bg-black/70"
      >
        {playing ? (
          <Pause aria-hidden="true" className="size-5" />
        ) : (
          <Play aria-hidden="true" className="size-5" />
        )}
      </button>
    </>
  );
}
