import { encodeWAV } from './audioUtils';

// Decodes the audio, slices the buffer to [startSec, endSec), and
// re-encodes as WAV via the existing encodeWAV utility — avoids pulling in
// an external encoder just to trim a clip.
export const trimAudioBlob = async (blob: Blob, startSec: number, endSec: number): Promise<Blob> => {
    const arrayBuffer = await blob.arrayBuffer();
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    const ctx = new AudioContextClass();
    try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const sampleRate = audioBuffer.sampleRate;
        const startSample = Math.max(0, Math.floor(startSec * sampleRate));
        const endSample = Math.min(audioBuffer.length, Math.floor(endSec * sampleRate));
        const frameCount = Math.max(1, endSample - startSample);

        // encodeWAV expects mono Float32 samples — mix down if the source
        // has multiple channels, matching this app's other audio paths
        // (recordings are already captured mono throughout).
        const trimmed = new Float32Array(frameCount);
        const channels = audioBuffer.numberOfChannels;
        for (let c = 0; c < channels; c++) {
            const channelData = audioBuffer.getChannelData(c);
            for (let i = 0; i < frameCount; i++) {
                trimmed[i] += channelData[startSample + i] / channels;
            }
        }

        return encodeWAV(trimmed, sampleRate);
    } finally {
        ctx.close();
    }
};

// Re-captures the video element's own media stream (video + audio tracks)
// from startSec to endSec via MediaRecorder. There's no ffmpeg.wasm
// dependency in this project, so this is the practical in-browser trim
// approach — it re-encodes to webm regardless of the source container.
export const trimVideoBlob = (blob: Blob, startSec: number, endSec: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = false;
        video.playsInline = true;
        const url = URL.createObjectURL(blob);
        video.src = url;
        let settled = false;

        const cleanup = () => {
            URL.revokeObjectURL(url);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
        const fail = (err: any) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
        };

        video.onloadedmetadata = async () => {
            try {
                const captureStream = (video as any).captureStream || (video as any).mozCaptureStream;
                if (!captureStream) {
                    throw new Error('Video trimming is not supported in this browser.');
                }

                video.currentTime = Math.max(0, startSec);
                await new Promise<void>((res) => { video.onseeked = () => res(); });

                const stream: MediaStream = captureStream.call(video);
                const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
                const chunks: Blob[] = [];
                recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                recorder.onstop = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(new Blob(chunks, { type: 'video/webm' }));
                };
                recorder.onerror = (e) => fail(e);

                recorder.start();
                await video.play();

                const checkEnd = () => {
                    if (settled) return;
                    if (video.currentTime >= endSec || video.ended) {
                        recorder.stop();
                    } else {
                        requestAnimationFrame(checkEnd);
                    }
                };
                requestAnimationFrame(checkEnd);
            } catch (e) {
                fail(e);
            }
        };
        video.onerror = () => fail(new Error('Failed to load video for trimming.'));
    });
};
