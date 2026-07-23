export const hapticFeedback = (pattern: number | number[] = 50) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
    }
};

// The canonical public origin for shareable post links. In local dev,
// window.location.origin is localhost — useless in a link anyone else could
// open, or that a social platform's link-unfurler bot could fetch for OG
// preview data — so fall back to a configurable deployed origin instead.
// Set VITE_PUBLIC_ORIGIN at build time to override the default fallback.
const FALLBACK_PUBLIC_ORIGIN = 'https://ais-pre-jzuicxor5ykd57l4xuevq4-414779155775.asia-east1.run.app';

export const getPublicOrigin = (): string => {
    const origin = window.location.origin;
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return import.meta.env.VITE_PUBLIC_ORIGIN || FALLBACK_PUBLIC_ORIGIN;
    }
    return origin;
};

export const getPostShareUrl = (post: { id: string; sourceUrl?: string }): string => {
    return post.sourceUrl || `${getPublicOrigin()}/s/${post.id}`;
};

export const generateThumbnail = async (blob: Blob, maxWidth = 800): Promise<Blob> => {
    if (!blob.type.startsWith('image/')) return blob;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Always redraw through canvas, even when not downscaling — this
            // strips EXIF metadata (including GPS) as a side effect of
            // re-encoding. Previously this bailed out early and returned the
            // raw blob unchanged for any image already <= maxWidth, silently
            // skipping metadata stripping for smaller photos.
            const scale = Math.min(1, maxWidth / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((b) => resolve(b || blob), 'image/webp', 0.8);
        };
        img.onerror = () => resolve(blob);
        img.src = URL.createObjectURL(blob);
    });
};

// Strips metadata (EXIF, including GPS location tags) from an image blob by
// re-encoding it through a canvas, while preserving full resolution (up to
// maxDim) and high quality — for the "original" full-resolution upload path,
// as opposed to generateThumbnail's deliberately lossy/downscaled output.
// This matters specifically for images picked from a device's photo library
// (as opposed to frames captured live through the in-app camera, which are
// already canvas-synthesized and never carry EXIF): camera photos routinely
// embed GPS coordinates, which would otherwise be uploaded and served
// publicly verbatim — e.g. leaking a nature photographer's home or a
// sensitive nest/den location.
export const stripImageMetadata = async (blob: Blob, maxDim = 4096, quality = 0.92): Promise<Blob> => {
    if (!blob.type.startsWith('image/')) return blob;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(blob); // fail open rather than block the upload
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const outputType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
            canvas.toBlob((b) => resolve(b || blob), outputType, quality);
        };
        img.onerror = () => resolve(blob); // fail open: better to keep the (unstripped) upload working than block it
        img.src = URL.createObjectURL(blob);
    });
};
