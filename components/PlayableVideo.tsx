import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const canPlayWebm = typeof document !== 'undefined' && !!document.createElement('video').canPlayType('video/webm');
const canPlayWebmAudio = typeof document !== 'undefined' && !!document.createElement('audio').canPlayType('audio/webm');
const cache = new Map<string, string>();

/** Storage object path from a Firebase download URL ("videos/uid/x.webm"). */
const storagePath = (url: string) => {
  const m = /\/o\/([^?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};

/**
 * Resolves a playable URL: WebM recordings are transcoded to MP4/H.264 by the
 * `transcodeVideo` Cloud Function (media_variants/{path}); browsers that can't play
 * WebM (iPhone Safari) get the MP4.
 */
export const resolvePlayableVideo = async (url?: string | null, kind: 'video' | 'audio' = 'video'): Promise<string | undefined> => {
  if (!url) return undefined;
  if (kind === 'video' ? canPlayWebm : canPlayWebmAudio) return url;
  const path = storagePath(url);
  if (!path || !/\.webm$/i.test(path)) return url;
  if (cache.has(url)) return cache.get(url);
  try {
    const snap = await getDoc(doc(db, 'media_variants', path.replace(/\//g, '|')));
    const mp4 = snap.exists() ? (snap.data() as any).mp4Url : null;
    const out = mp4 || url;
    cache.set(url, out);
    return out;
  } catch { return url; }
};

/** A still frame for a video that has none (made by the server when it converts the video). */
const posterCache = new Map<string, string | null>();
export const resolvePoster = async (url?: string | null): Promise<string | null> => {
  if (!url) return null;
  if (posterCache.has(url)) return posterCache.get(url)!;
  const path = storagePath(url);
  if (!path) return null;
  try {
    const snap = await getDoc(doc(db, 'media_variants', path.replace(/\//g, '|')));
    const poster = snap.exists() ? ((snap.data() as any).posterUrl || null) : null;
    posterCache.set(url, poster);
    return poster;
  } catch { return null; }
};

type Props = React.VideoHTMLAttributes<HTMLVideoElement> & { src?: string };

const PlayableVideo = React.forwardRef<HTMLVideoElement, Props>(({ src, ...rest }, ref) => {
  const [resolved, setResolved] = useState<string | undefined>(canPlayWebm ? src : undefined);
  useEffect(() => {
    let active = true;
    resolvePlayableVideo(src).then(u => { if (active) setResolved(u); });
    return () => { active = false; };
  }, [src]);
  return <video ref={ref} src={resolved} {...rest} />;
});
PlayableVideo.displayName = 'PlayableVideo';

export default PlayableVideo;

type AudioProps = React.AudioHTMLAttributes<HTMLAudioElement> & { src?: string };
export const PlayableAudio: React.FC<AudioProps> = ({ src, ...rest }) => {
  const [resolved, setResolved] = useState<string | undefined>(canPlayWebmAudio ? src : undefined);
  useEffect(() => {
    let active = true;
    resolvePlayableVideo(src, 'audio').then(u => { if (active) setResolved(u); });
    return () => { active = false; };
  }, [src]);
  return <audio src={resolved} {...rest} />;
};
