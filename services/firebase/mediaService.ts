// W2: extracted from firebaseService.ts — Firebase Storage uploads for
// captured/uploaded media (images/video/audio).
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { storage } from "../../firebaseConfig";
import { getCorsProxyUrl } from "./shared";

export const MediaService = {
  uploadMedia: async (data: Blob | string, userId: string, type: 'image' | 'video' | 'audio'): Promise<string> => {
    let blob: Blob;
    if (typeof data === 'string') {
        const response = await fetch(getCorsProxyUrl(data));
        blob = await response.blob();
    } else { blob = data; }

    const mime = blob.type;
    let ext = 'jpg'; 
    if (type === 'video') ext = 'mp4';
    else if (type === 'audio') ext = 'webm';
    else if (mime.includes('png')) ext = 'png';

    const uniqueId = Math.random().toString(36).substring(2, 9);
    const folder = type === 'image' ? 'snapshots' : (type === 'audio' ? 'audio' : 'videos');
    const filename = `${folder}/${userId}/${Date.now()}_${uniqueId}.${ext}`;
    const storageRef = ref(storage, filename);
    await uploadBytes(storageRef, blob, { contentType: mime });
    return await getDownloadURL(storageRef);
  },
};
