import { Snapshot } from '../types';
import { compressImageToBlob } from './audioUtils';
import { GenAiService, resolveNatureSubjectFields } from './genAiService';

export class UploadValidationError extends Error {}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/x-m4a'];
const ALLOWED_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES]);

export const MAX_UPLOAD_DURATION_SECONDS = 30;
const METADATA_LOAD_TIMEOUT_MS = 10000;

export type UploadMediaType = 'image' | 'video' | 'audio';

export const classifyUpload = (file: File): UploadMediaType => {
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'image';
};

// Explicit allow-list rather than trusting the browser-reported MIME type
// alone to be well-formed — an empty or unrecognized type fails closed with
// a message the user can act on, instead of being handed to the AI pipeline
// or Storage as an unknown blob.
export const validateUploadFile = (file: File): void => {
    if (!ALLOWED_TYPES.has(file.type)) {
        throw new UploadValidationError(
            file.type ? `"${file.type}" isn't a supported file type.` : "This file type couldn't be recognized."
        );
    }
};

// Reads video/audio duration via the browser's own decoder, guarded by a
// timeout — a truncated or corrupt file can otherwise leave loadedmetadata
// pending forever and hang the upload UI with no feedback.
export const readMediaDuration = (file: File, mediaType: 'video' | 'audio'): Promise<number> => {
    return new Promise((resolve, reject) => {
        const media = mediaType === 'video' ? document.createElement('video') : document.createElement('audio');
        const objectUrl = URL.createObjectURL(file);
        let settled = false;

        const cleanup = () => {
            URL.revokeObjectURL(objectUrl);
            media.removeAttribute('src');
            media.load();
        };

        const timeoutId = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new UploadValidationError("This file took too long to read — it may be corrupted."));
        }, METADATA_LOAD_TIMEOUT_MS);

        media.onloadedmetadata = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            const duration = media.duration;
            cleanup();
            resolve(duration);
        };
        media.onerror = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            cleanup();
            reject(new UploadValidationError("Couldn't read this file — it may be corrupted or unsupported."));
        };
        media.src = objectUrl;
    });
};

// Normalizes an uploaded image by redrawing it to a canvas. Browsers apply
// EXIF orientation when decoding for canvas draw, so this both bakes the
// correct rotation into the output pixels (no orientation tag ambiguity for
// downstream consumers, including the AI pipeline) and brings oversized
// phone-camera photos down to a sane size, matching what camera captures
// already go through.
export const normalizeUploadedImage = async (file: File): Promise<Blob> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new UploadValidationError("Couldn't read this image file."));
        reader.readAsDataURL(file);
    });
    return compressImageToBlob(dataUrl, 1920, 0.88);
};

export interface UploadAnalysisResult {
    labels: string[];
    aiInsight: string;
    isNatureSubject: boolean;
    isHybrid: boolean;
    confidence?: 'high' | 'medium' | 'low';
    locationArea: string;
}

// Shared by every upload entry point (the standalone no-camera flow and the
// in-session upload button) so scope-gate, confidence, and hybrid handling
// can't drift between them.
export const analyzeUploadedMedia = async (
    media: Blob,
    mediaType: UploadMediaType,
    location?: string
): Promise<UploadAnalysisResult> => {
    const result = await GenAiService.analyzeMedia(media, mediaType, location);
    const { labels, aiInsight, isNatureSubject } = resolveNatureSubjectFields(result);
    return {
        labels,
        aiInsight,
        isNatureSubject,
        isHybrid: isNatureSubject && !!result.isHybrid,
        confidence: result.confidence,
        locationArea: result.location,
    };
};

export interface PreparedUpload {
    mediaType: UploadMediaType;
    analysisMedia: Blob;
    snapshotFields: Partial<Snapshot>;
}

// Validates the file, enforces the duration cap, and (for images) normalizes
// orientation/size — the shared first step before either upload entry point
// builds its Snapshot and kicks off analysis.
export const prepareUpload = async (file: File): Promise<PreparedUpload> => {
    validateUploadFile(file);
    const mediaType = classifyUpload(file);

    if (mediaType === 'video' || mediaType === 'audio') {
        const duration = await readMediaDuration(file, mediaType);
        if (duration > MAX_UPLOAD_DURATION_SECONDS) {
            throw new UploadValidationError(`Please select a file that's ${MAX_UPLOAD_DURATION_SECONDS} seconds or shorter.`);
        }
    }

    if (mediaType === 'image') {
        const normalized = await normalizeUploadedImage(file);
        return {
            mediaType,
            analysisMedia: normalized,
            snapshotFields: {
                url: URL.createObjectURL(normalized),
                blob: normalized,
                type: 'image',
            },
        };
    }

    if (mediaType === 'video') {
        return {
            mediaType,
            analysisMedia: file,
            snapshotFields: {
                videoUrl: URL.createObjectURL(file),
                videoBlob: file,
                type: 'video',
            },
        };
    }

    return {
        mediaType,
        analysisMedia: file,
        snapshotFields: {
            audioUrl: URL.createObjectURL(file),
            audioBlob: file,
            type: 'audio',
        },
    };
};
