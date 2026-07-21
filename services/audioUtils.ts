import { getCorsProxyUrl } from './firebaseService';

export function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

/**
 * Encodes raw PCM data into a standard WAV file with a 44-byte RIFF header.
 */
export function encodeWAV(samples: Float32Array, sampleRate: number = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export async function compressImageToBlob(dataUrl: string, maxDim: number = 1080, quality: number = 0.80): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } }
      else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('No ctx');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject('Fail'), 'image/jpeg', quality);
    };
    img.onerror = () => reject('Load fail');
    img.src = dataUrl;
  });
}

export async function generateFieldCard(
    imageSource: Blob | string, 
    label: string,
    dateString: string
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let objectUrl: string | null = null;
        
        const cleanup = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const targetWidth = 1080; 
            const scale = targetWidth / img.width;
            canvas.width = targetWidth;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            if (!ctx) { cleanup(); return reject(new Error("No Canvas Context")); }
            
            try {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(b => { cleanup(); if(b) resolve(b); else reject(new Error("Blob failed")); }, 'image/jpeg', 0.80);
            } catch (e) {
                // Fallback: If canvas is tainted, return original as blob
                cleanup();
                if (imageSource instanceof Blob) resolve(imageSource);
                else fetch(getCorsProxyUrl(imageSource)).then(r => r.blob()).then(resolve).catch(reject);
            }
        };

        img.onerror = () => { cleanup(); reject(new Error("Load fail")); };

        if (imageSource instanceof Blob) {
            objectUrl = URL.createObjectURL(imageSource);
            img.src = objectUrl;
        } else if (typeof imageSource === 'string') {
            img.crossOrigin = "Anonymous";
            const proxyUrl = getCorsProxyUrl(imageSource);
            img.src = proxyUrl.startsWith('data:') || proxyUrl.startsWith('/api/') ? proxyUrl : `${proxyUrl}${proxyUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
        }
    });
}