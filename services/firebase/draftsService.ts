// W2: extracted from firebaseService.ts — expedition draft save/resume/
// delete, with the existing Firestore-primary/localStorage-fallback
// pattern (and lazy 30-day expiry) unchanged.
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { Snapshot, ExpeditionDraft } from "../../types";
import { handleFirestoreError, OperationType } from "./shared";
import { FirebaseService } from "../firebaseService";

export const DraftsService = {
  // Strip Blobs and non-serializable properties before storing (otherwise
  // setDoc/updateDoc throws). Also keeps the AI-correction/confidence
  // metadata so a resumed-and-published draft doesn't lose that signal.
  _sanitizeDraftSnapshots: (snapshots: Snapshot[]) => snapshots.map(s => {
      const cleanImg = s.associatedImages ? s.associatedImages.map(img => ({
        url: img.url || null
      })) : null;
      return {
        id: s.id,
        url: s.url || '',
        videoUrl: s.videoUrl || '',
        audioUrl: s.audioUrl || '',
        timestamp: s.timestamp || '',
        labels: s.labels || [],
        behavior: s.behavior || '',
        aiInsight: s.aiInsight || '',
        type: s.type || 'image',
        userId: s.userId || '',
        isHybrid: !!s.isHybrid,
        location: s.location || '',
        locationArea: s.locationArea || '',
        rotation: s.rotation || 0,
        associatedImages: cleanImg,
        isNatureSubject: s.isNatureSubject ?? null,
        confidence: s.confidence || null,
        aiProposedLabels: s.aiProposedLabels || [],
        aiProposedBehavior: s.aiProposedBehavior || '',
        humanDelta: !!s.humanDelta,
        sessionRetakes: s.sessionRetakes || 0,
        rawLocation: s.rawLocation || null,
        timeToRecordMs: s.timeToRecordMs || 0,
        isSensitiveSpecies: s.isSensitiveSpecies ?? null,
        subjects: s.subjects || null,
        candidates: s.candidates || null,
        soundscape: s.soundscape || null,
      };
  }),

  saveDraft: async (userId: string, snapshots: Snapshot[], summary: string) => {
    const cleanSnapshots = FirebaseService._sanitizeDraftSnapshots(snapshots);

    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser) {
        const draftRef = doc(collection(db, "users", userId, "drafts"));
        const draftData = {
          userId,
          snapshots: cleanSnapshots,
          summary,
          timestamp: serverTimestamp()
        };
        await setDoc(draftRef, draftData);
        return draftRef.id;
      }
    } catch (e) {
      console.warn("Firestore saveDraft failed:", e);
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/drafts`);
    }

    // LocalStorage Fallback just in case
    try {
      const localDrafts = JSON.parse(localStorage.getItem(`drafts_${userId}`) || "[]");
      const newDraft = {
        id: "local_" + Date.now(),
        userId,
        snapshots: cleanSnapshots,
        summary,
        timestamp: { toDate: () => new Date() }
      };
      localDrafts.unshift(newDraft);
      localStorage.setItem(`drafts_${userId}`, JSON.stringify(localDrafts));
      return newDraft.id;
    } catch (err) {
      console.error("Local draft saving failed:", err);
      return "local_temp";
    }
  },

  // Overwrites an existing draft in place rather than inserting a new
  // document — used by auto-save (so repeated saves during one session
  // update a single running draft instead of multiplying) and by resuming
  // a draft (so continuing to capture after a resume updates the same
  // draft instead of orphaning it).
  updateDraft: async (userId: string, draftId: string, snapshots: Snapshot[], summary: string) => {
    const cleanSnapshots = FirebaseService._sanitizeDraftSnapshots(snapshots);

    if (draftId.startsWith("local_")) {
      try {
        const localDrafts = JSON.parse(localStorage.getItem(`drafts_${userId}`) || "[]");
        const idx = localDrafts.findIndex((d: any) => d.id === draftId);
        if (idx !== -1) {
          localDrafts[idx] = { ...localDrafts[idx], snapshots: cleanSnapshots, summary };
          localStorage.setItem(`drafts_${userId}`, JSON.stringify(localDrafts));
        }
      } catch (err) {
        console.error("Local updateDraft failed:", err);
      }
      return;
    }

    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser) {
        await updateDoc(doc(db, "users", userId, "drafts", draftId), {
          snapshots: cleanSnapshots,
          summary,
          timestamp: serverTimestamp()
        });
      }
    } catch (e) {
      console.warn("Firestore updateDraft failed:", e);
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/drafts/${draftId}`);
    }
  },

  getDrafts: async (userId: string): Promise<ExpeditionDraft[]> => {
    let firestoreDrafts: ExpeditionDraft[] = [];
    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser) {
        const q = query(collection(db, "users", userId, "drafts"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        firestoreDrafts = snap.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp
          } as ExpeditionDraft;
        });
      }
    } catch (e) {
      console.warn("Firestore getDrafts failed:", e);
      handleFirestoreError(e, OperationType.GET, `users/${userId}/drafts`);
    }

    // Load from local drafts
    let formattedLocal: ExpeditionDraft[] = [];
    try {
      const localDrafts = JSON.parse(localStorage.getItem(`drafts_${userId}`) || "[]");
      formattedLocal = localDrafts.map((d: any) => ({
        ...d,
        timestamp: {
          toDate: () => new Date(d.timestamp?.seconds ? d.timestamp.seconds * 1000 : (typeof d.timestamp === 'string' ? d.timestamp : Date.now()))
        }
      }));
    } catch (err) {
      console.error("Local getDrafts parsing failed", err);
    }

    const allDrafts = [...formattedLocal, ...firestoreDrafts];

    // Lazily expire old drafts instead of running a server-side cron (none
    // exists in this project): anything past DRAFT_EXPIRY_MS is dropped
    // from the returned list and best-effort deleted in the background.
    const DRAFT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();
    const fresh: ExpeditionDraft[] = [];
    const expired: ExpeditionDraft[] = [];
    for (const d of allDrafts) {
      // A null/missing timestamp usually just means a serverTimestamp()
      // write hasn't resolved in the local cache yet — treat that as
      // fresh rather than risk deleting a draft that was only just saved.
      const draftDate = d.timestamp?.toDate ? d.timestamp.toDate() : null;
      if (draftDate && now - draftDate.getTime() > DRAFT_EXPIRY_MS) {
        expired.push(d);
      } else {
        fresh.push(d);
      }
    }
    if (expired.length > 0) {
      Promise.all(expired.map(d => FirebaseService.deleteDraft(userId, d.id))).catch(() => {});
    }

    return fresh;
  },

  deleteDraft: async (userId: string, draftId: string) => {
    if (draftId && draftId.startsWith("local_")) {
      try {
        const localDrafts = JSON.parse(localStorage.getItem(`drafts_${userId}`) || "[]");
        const updated = localDrafts.filter((d: any) => d.id !== draftId);
        localStorage.setItem(`drafts_${userId}`, JSON.stringify(updated));
      } catch (err) {
        console.error("Local deleteDraft failed", err);
      }
      return;
    }

    try {
      if (userId && userId !== 'explorer_guest' && auth.currentUser) {
        await deleteDoc(doc(db, "users", userId, "drafts", draftId));
      }
    } catch (e) {
      console.warn("Firestore deleteDraft failed:", e);
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/drafts/${draftId}`);
    }
  },
};
