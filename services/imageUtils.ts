import { getCorsProxyUrl } from "./firebaseService";

export const applyImageAdjustments = async (
  source: Blob | string, 
  adjustments: { brightness?: number, contrast?: number, flipH?: boolean, flipV?: boolean }
): Promise<Blob> => {
  return new Promise(async (resolve, reject) => {
    let blob: Blob;
    if (typeof source === 'string') {
      try {
        const response = await fetch(getCorsProxyUrl(source));
        blob = await response.blob();
      } catch (e) {
        return reject(e);
      }
    } else {
      blob = source;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));

      canvas.width = img.width;
      canvas.height = img.height;

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(adjustments.flipH ? -1 : 1, adjustments.flipV ? -1 : 1);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      ctx.filter = `brightness(${adjustments.brightness ?? 100}%) contrast(${adjustments.contrast ?? 100}%)`;
      ctx.drawImage(img, 0, 0);
      ctx.restore();

      canvas.toBlob((newBlob) => {
        if (newBlob) resolve(newBlob);
        else reject(new Error('Failed to create blob'));
      }, blob.type || 'image/jpeg');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
};

export const applyFilter = async (source: Blob | string, filter: 'grayscale' | 'none'): Promise<Blob> => {
  return new Promise(async (resolve, reject) => {
    let blob: Blob;
    if (typeof source === 'string') {
      try {
        const response = await fetch(getCorsProxyUrl(source));
        blob = await response.blob();
      } catch (e) {
        return reject(e);
      }
    } else {
      blob = source;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));

      canvas.width = img.width;
      canvas.height = img.height;

      ctx.filter = filter === 'grayscale' ? 'grayscale(100%)' : 'none';
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((newBlob) => {
        if (newBlob) resolve(newBlob);
        else reject(new Error('Failed to create blob'));
      }, blob.type || 'image/jpeg');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
};

// cropRect is in normalized 0-1 fractions of the image's natural dimensions
// (not pixels) so the same crop rect works regardless of how the image is
// displayed on screen.
export const cropImageBlob = async (
  source: Blob | string,
  cropRect: { x: number, y: number, width: number, height: number }
): Promise<Blob> => {
  return new Promise(async (resolve, reject) => {
    let blob: Blob;
    if (typeof source === 'string') {
      try {
        const response = await fetch(getCorsProxyUrl(source));
        blob = await response.blob();
      } catch (e) {
        return reject(e);
      }
    } else {
      blob = source;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));

      const sx = Math.max(0, cropRect.x * img.width);
      const sy = Math.max(0, cropRect.y * img.height);
      const sw = Math.max(1, cropRect.width * img.width);
      const sh = Math.max(1, cropRect.height * img.height);

      canvas.width = sw;
      canvas.height = sh;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      canvas.toBlob((newBlob) => {
        if (newBlob) resolve(newBlob);
        else reject(new Error('Failed to create blob'));
      }, blob.type || 'image/jpeg');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
};

export const rotateImageBlob = async (source: Blob | string, degrees: number): Promise<Blob> => {
  return new Promise(async (resolve, reject) => {
    let blob: Blob;
    if (typeof source === 'string') {
      try {
        const response = await fetch(getCorsProxyUrl(source));
        blob = await response.blob();
      } catch (e) {
        return reject(e);
      }
    } else {
      blob = source;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));

      const normalizedDegrees = ((degrees % 360) + 360) % 360;
      
      canvas.width = (normalizedDegrees === 90 || normalizedDegrees === 270) ? img.height : img.width;
      canvas.height = (normalizedDegrees === 90 || normalizedDegrees === 270) ? img.width : img.height;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((normalizedDegrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      canvas.toBlob((newBlob) => {
        if (newBlob) resolve(newBlob);
        else reject(new Error('Failed to create blob'));
      }, blob.type || 'image/jpeg');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
};
