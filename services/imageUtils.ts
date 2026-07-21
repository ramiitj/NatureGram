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
