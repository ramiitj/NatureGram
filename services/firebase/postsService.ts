// W2: extracted from firebaseService.ts — post creation (session/single
// observation), feed/journal reads, likes, and the map/taxonomy/audio-
// dataset read paths that all query ecosystem_feed/feed_thumbnails.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { CommunityPost, Snapshot } from "../../types";
import { generateThumbnail, stripImageMetadata } from "../../utils";
import { resolveCanonicalTaxa } from "../taxonomyService";
import { encodeGeohash } from "../geohashService";
import { handleFirestoreError, OperationType, screenPostSafety } from "./shared";
import { FirebaseService } from "../firebaseService";

export const PostsService = {
  createSessionObservation: async (snapshots: Snapshot[], userId: string, flags: { feed: boolean, journal: boolean }, tags: string[], synthesizedData?: { title: string, description: string }) => {
    try {
      const effectiveUserId = userId || auth.currentUser?.uid;
      if (!effectiveUserId) throw new Error("No user found.");

      const userProfile = await FirebaseService.getUserProfile(effectiveUserId);
      const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${effectiveUserId.slice(0, 4)}`;

      const items = await Promise.all(snapshots.map(async (snapshot) => {
          let publicUrl: string | undefined = undefined;
          let thumbnailUrl: string | undefined = undefined;
          let originalImageUrl: string | undefined = undefined;
          const uploadSource = snapshot.blob || snapshot.url;
          if (uploadSource) {
              if (snapshot.blob && snapshot.type === 'image') {
                  // Strip EXIF/GPS metadata before uploading the full-resolution
                  // "original" — matters most for gallery-picked photos (live
                  // camera captures never carry EXIF to begin with, since
                  // they're synthesized via canvas already).
                  const strippedBlob = await stripImageMetadata(snapshot.blob);
                  originalImageUrl = await FirebaseService.uploadMedia(strippedBlob, effectiveUserId, 'image');
                  const thumbBlob = await generateThumbnail(snapshot.blob, 800);
                  publicUrl = await FirebaseService.uploadMedia(thumbBlob, effectiveUserId, 'image');
                  thumbnailUrl = publicUrl;
              } else {
                  publicUrl = await FirebaseService.uploadMedia(uploadSource, effectiveUserId, 'image');
              }
          }
          
          let videoUrl: string | undefined = undefined;
          if (snapshot.videoBlob) {
            videoUrl = await FirebaseService.uploadMedia(snapshot.videoBlob, effectiveUserId, 'video');
          }

          let audioUrl: string | undefined = undefined;
          if (snapshot.audioBlob) {
              audioUrl = await FirebaseService.uploadMedia(snapshot.audioBlob, effectiveUserId, 'audio');
          }

          let associatedImageUrls: string[] = [];
          if (snapshot.associatedImages && snapshot.associatedImages.length > 0) {
              associatedImageUrls = await Promise.all(
                  snapshot.associatedImages.map(img => 
                      FirebaseService.uploadMedia(img.blob || img.url!, effectiveUserId, 'image')
                  )
              );
          }

          return {
            imageUrl: publicUrl || null,
            thumbnailUrl: thumbnailUrl || null,
            originalImageUrl: originalImageUrl || null,
            videoUrl: videoUrl || null,
            audioUrl: audioUrl || null,
            associatedImageUrls: associatedImageUrls,
            mediaType: snapshot.type,
            labels: snapshot.labels || [],
            behavior: snapshot.behavior || "Observation.",
            aiInsight: snapshot.aiInsight || null,
            locationArea: snapshot.locationArea || "",
            showLocation: (snapshot as any).showLocation ?? true,
            rotation: snapshot.rotation || 0,
            rawLocation: snapshot.rawLocation || null,
            timeToRecordMs: snapshot.timeToRecordMs || null,
            aiProposedLabels: snapshot.aiProposedLabels || null,
            aiProposedBehavior: snapshot.aiProposedBehavior || null,
            humanDelta: snapshot.humanDelta || false,
            sessionRetakes: snapshot.sessionRetakes || null,
            isNatureSubject: snapshot.isNatureSubject ?? null,
            confidence: snapshot.confidence || null,
            isSensitiveSpecies: snapshot.isSensitiveSpecies ?? null,
            subjects: snapshot.subjects || null,
            candidates: snapshot.candidates || null,
            soundscape: snapshot.soundscape || null,
            snapshotId: snapshot.id,
          };
      }));

      // The AI-correction signal (humanDelta) is already computed per
      // snapshot by the caller (PostSessionView); feed it back into that
      // snapshot's quality event now, at the moment its final labels are
      // known, rather than requiring a separate post-publish edit to do so.
      snapshots.forEach(s => {
        if (s.humanDelta && s.id) {
          FirebaseService.recordQualityEventCorrection(s.id, s.labels || []).catch(() => {});
        }
      });

      if (items.length === 0) throw new Error("No items to upload.");

      const primaryItem = items[0];
      const allLabels = new Set<string>();
      items.forEach(item => item.labels.forEach(l => allLabels.add(l)));

      const primarySnapshot = snapshots[0];
      const safetyCheckBlob = primaryItem.mediaType === 'video' ? primarySnapshot.videoBlob
        : primaryItem.mediaType === 'audio' ? primarySnapshot.audioBlob
        : primarySnapshot.blob;
      const moderation = await screenPostSafety(safetyCheckBlob);

      // T4: geohash for the species map. Never computed for sensitive
      // species — those posts simply don't appear on the map, same
      // protection already applied to their locationArea display.
      const isSensitiveForMap = snapshots.some(s => s.isSensitiveSpecies);
      const mapGeohash = (!isSensitiveForMap && primaryItem.rawLocation)
        ? encodeGeohash(primaryItem.rawLocation.lat, primaryItem.rawLocation.lng)
        : null;

      const postData: any = {
        userId: effectiveUserId,
        userName: userName,
        imageUrl: primaryItem.imageUrl,
        thumbnailUrl: primaryItem.thumbnailUrl,
        originalImageUrl: primaryItem.originalImageUrl,
        videoUrl: primaryItem.videoUrl,
        audioUrl: primaryItem.audioUrl,
        associatedImageUrls: primaryItem.associatedImageUrls,
        mediaType: primaryItem.mediaType,
        labels: Array.from(allLabels),
        behavior: synthesizedData ? synthesizedData.description : primaryItem.behavior,
        aiInsight: primaryItem.aiInsight,
        locationArea: primaryItem.locationArea,
        showLocation: primaryItem.showLocation,
        tags: tags,
        timestamp: serverTimestamp(),
        likes: [],
        commentCount: 0,
        isPublic: flags.feed,
        isJournal: flags.journal,
        reportStatus: moderation.reportStatus,
        reports: moderation.reports,
        isHybrid: snapshots.some(s => s.isHybrid || (s.associatedImages && s.associatedImages.length > 0)),
        items: items,
        rotation: primaryItem.rotation || 0,
        rawLocation: primaryItem.rawLocation || null,
        timeToRecordMs: primaryItem.timeToRecordMs || null,
        sessionRetakes: primaryItem.sessionRetakes || null,
        humanDelta: primaryItem.humanDelta || false,
        isNatureSubject: primaryItem.isNatureSubject ?? null,
        confidence: primaryItem.confidence || null,
        isSensitiveSpecies: snapshots.some(s => s.isSensitiveSpecies),
        subjects: primaryItem.subjects || null,
        candidates: primaryItem.candidates || null,
        soundscape: primaryItem.soundscape || null,
        snapshotId: primaryItem.snapshotId,
        geohash: mapGeohash,
      };

      if (synthesizedData) {
          postData.title = synthesizedData.title;
          postData.description = synthesizedData.description;
      }

      const docRef = await addDoc(collection(db, "ecosystem_feed"), postData);
      FirebaseService.enrichPostTaxonomy(docRef.id, Array.from(allLabels)).catch(() => {});

      const thumbData = {
          id: docRef.id,
          mediaType: primaryItem.mediaType,
          thumbnailUrl: primaryItem.thumbnailUrl || primaryItem.imageUrl || "",
          title: synthesizedData?.title || null,
          description: synthesizedData?.description || null,
          timestamp: postData.timestamp,
          userId: effectiveUserId,
          userName: userName,
          likes: [],
          commentCount: 0,
          isPublic: flags.feed,
          tags: tags,
          labels: Array.from(allLabels),
          behavior: synthesizedData?.description || primaryItem.behavior || "",
          aiInsight: primaryItem.aiInsight || null,
          locationArea: primaryItem.locationArea || "",
          isHybrid: postData.isHybrid,
          reportStatus: moderation.reportStatus,
          reports: moderation.reports
      };
      await setDoc(doc(db, "feed_thumbnails", docRef.id), thumbData);
      
      try {
        await updateDoc(doc(db, "users", effectiveUserId), { 
          "stats.observations": increment(items.length),
          "stats.species": increment(allLabels.size) 
        });
      } catch (statsErr) {
        console.warn("Failed to update user stats in createSessionObservation:", statsErr);
      }
      return { id: docRef.id };
    } catch (e) {
      console.error("Error creating session observation:", e);
      throw e;
    }
  },

  createObservation: async (snapshot: Snapshot, userId: string, flags: { feed: boolean, journal: boolean }, synthesis: string, tags: string[]) => {
    try {
      const effectiveUserId = userId || auth.currentUser?.uid;
      if (!effectiveUserId) throw new Error("No user found.");

      const userProfile = await FirebaseService.getUserProfile(effectiveUserId);
      const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${effectiveUserId.slice(0, 4)}`;

      let publicUrl: string | undefined = undefined;
      let thumbnailUrl: string | undefined = undefined;
      let originalImageUrl: string | undefined = undefined;
      const uploadSource = snapshot.blob || snapshot.url;
      if (uploadSource) {
          if (snapshot.blob && snapshot.type === 'image') {
              // Strip EXIF/GPS metadata before uploading the full-resolution
              // "original" — matters most for gallery-picked photos (live
              // camera captures never carry EXIF to begin with, since
              // they're synthesized via canvas already).
              const strippedBlob = await stripImageMetadata(snapshot.blob);
              originalImageUrl = await FirebaseService.uploadMedia(strippedBlob, effectiveUserId, 'image');
              const thumbBlob = await generateThumbnail(snapshot.blob, 800);
              publicUrl = await FirebaseService.uploadMedia(thumbBlob, effectiveUserId, 'image');
              thumbnailUrl = publicUrl;
          } else {
              publicUrl = await FirebaseService.uploadMedia(uploadSource, effectiveUserId, 'image');
          }
      }
      
      let videoUrl: string | undefined = undefined;
      if (snapshot.videoBlob) {
        videoUrl = await FirebaseService.uploadMedia(snapshot.videoBlob, effectiveUserId, 'video');
      }

      let audioUrl: string | undefined = undefined;
      if (snapshot.audioBlob) {
          audioUrl = await FirebaseService.uploadMedia(snapshot.audioBlob, effectiveUserId, 'audio');
      }

      let associatedImageUrls: string[] = [];
      if (snapshot.associatedImages && snapshot.associatedImages.length > 0) {
          associatedImageUrls = await Promise.all(
              snapshot.associatedImages.map(img =>
                  FirebaseService.uploadMedia(img.blob || img.url!, effectiveUserId, 'image')
              )
          );
      }

      const safetyCheckBlob = snapshot.type === 'video' ? snapshot.videoBlob
        : snapshot.type === 'audio' ? snapshot.audioBlob
        : snapshot.blob;
      const moderation = await screenPostSafety(safetyCheckBlob);

      // T4: geohash for the species map — never computed for sensitive
      // species (see createSessionObservation's identical rationale above).
      const mapGeohash = (!snapshot.isSensitiveSpecies && snapshot.rawLocation)
        ? encodeGeohash(snapshot.rawLocation.lat, snapshot.rawLocation.lng)
        : null;

      const postData: any = {
        userId: effectiveUserId,
        userName: userName,
        imageUrl: publicUrl || null,
        thumbnailUrl: thumbnailUrl || null,
        originalImageUrl: originalImageUrl || null,
        videoUrl: videoUrl || null,
        audioUrl: audioUrl || null,
        associatedImageUrls: associatedImageUrls,
        mediaType: snapshot.type,
        labels: snapshot.labels,
        behavior: synthesis,
        aiInsight: snapshot.aiInsight || null,
        locationArea: snapshot.locationArea || "",
        showLocation: (snapshot as any).showLocation ?? true,
        tags: tags,
        timestamp: serverTimestamp(),
        likes: [],
        commentCount: 0,
        isPublic: flags.feed,
        isJournal: flags.journal,
        reportStatus: moderation.reportStatus,
        reports: moderation.reports,
        isHybrid: snapshot.isHybrid || associatedImageUrls.length > 0,
        rotation: snapshot.rotation || 0,
        rawLocation: snapshot.rawLocation || null,
        timeToRecordMs: snapshot.timeToRecordMs || null,
        aiProposedLabels: snapshot.aiProposedLabels || null,
        aiProposedBehavior: snapshot.aiProposedBehavior || null,
        sessionRetakes: snapshot.sessionRetakes || null,
        humanDelta: snapshot.humanDelta || false,
        isNatureSubject: snapshot.isNatureSubject ?? null,
        confidence: snapshot.confidence || null,
        isSensitiveSpecies: snapshot.isSensitiveSpecies ?? null,
        subjects: snapshot.subjects || null,
        candidates: snapshot.candidates || null,
        soundscape: snapshot.soundscape || null,
        snapshotId: snapshot.id,
        geohash: mapGeohash,
      };

      if (snapshot.humanDelta && snapshot.id) {
        FirebaseService.recordQualityEventCorrection(snapshot.id, snapshot.labels || []).catch(() => {});
      }

      const docRef = await addDoc(collection(db, "ecosystem_feed"), postData);
      FirebaseService.enrichPostTaxonomy(docRef.id, snapshot.labels || []).catch(() => {});

      const thumbData = {
          id: docRef.id,
          mediaType: snapshot.type,
          thumbnailUrl: thumbnailUrl || publicUrl || "",
          timestamp: postData.timestamp,
          userId: effectiveUserId,
          userName: userName,
          likes: [],
          commentCount: 0,
          isPublic: flags.feed,
          tags: tags,
          labels: snapshot.labels || [],
          behavior: synthesis,
          aiInsight: snapshot.aiInsight || null,
          locationArea: snapshot.locationArea || "",
          isHybrid: postData.isHybrid,
          reportStatus: moderation.reportStatus,
          reports: moderation.reports
      };
      await setDoc(doc(db, "feed_thumbnails", docRef.id), thumbData);
      
      try {
        await updateDoc(doc(db, "users", effectiveUserId), { 
          "stats.observations": increment(1),
          "stats.species": increment(snapshot.labels.length) 
        });
      } catch (statsErr) {
        console.warn("Failed to update user stats in createObservation:", statsErr);
      }
      return { id: docRef.id, url: publicUrl, videoUrl, audioUrl };
    } catch (e) {
      console.error("Error creating observation:", e);
      throw e;
    }
  },

  subscribeToFeed: (callback: (posts: CommunityPost[]) => void, searchTag?: string | null) => {
    let q;
    if (searchTag) {
        const normalizedTag = searchTag.startsWith('#') ? searchTag : `#${searchTag.toLowerCase().replace(/\s+/g, '')}`;
        // isPublic is filtered at the query level (every write path sets it
        // explicitly — see getMorePosts for the fuller rationale); bounded
        // with orderBy+limit like the non-tag branch below, since this was
        // previously unbounded (a live listener with no cap on result size).
        q = query(
            collection(db, "feed_thumbnails"),
            where("tags", "array-contains", normalizedTag),
            where("isPublic", "==", true),
            orderBy("timestamp", "desc"),
            limit(20)
        );
    } else {
        q = query(
            collection(db, "feed_thumbnails"),
            where("isPublic", "==", true),
            orderBy("timestamp", "desc"),
            limit(20)
        );
    }

    return onSnapshot(q, (snapshot) => {
      const posts: CommunityPost[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        // reportStatus stays a client-side filter deliberately: unlike
        // isPublic (always explicitly set), older/seed posts predate this
        // field entirely, and a Firestore "==" filter would treat a missing
        // field as non-matching — silently hiding all of them from the
        // feed. This is also why it's "!== 'pending'" rather than
        // "=== 'safe'": absent is treated as safe, not excluded.
        if (data.reportStatus !== 'pending') {
          posts.push({
            id: doc.id,
            ...data,
            labels: data.labels || (data.label ? [data.label] : ["Nature"])
          } as CommunityPost);
        }
      });

      // Always sort the array by timestamp descending to ensure perfect ordering without composite indexes
      posts.sort((a, b) => {
        const getT = (ts: any) => ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : (ts ? new Date(ts).getTime() : 0));
        return getT(b.timestamp) - getT(a.timestamp);
      });

      callback(posts);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "feed_thumbnails");
    });
  },

  getMorePosts: async (lastVisible: any, searchTag?: string | null): Promise<{ posts: CommunityPost[], lastVisible: any }> => {
      // isPublic is filtered at the query level below — every write path
      // sets it explicitly (post creation, seed data, migrations), so
      // there's no "missing field" case to worry about, unlike
      // reportStatus (see the client-side filter below for why that one's
      // different). Filtering it in the query — rather than fetching a
      // fixed-size page and discarding non-public rows afterward — is what
      // actually fixes pagination: previously, a page could come back
      // mostly (or entirely) private/journal-only posts and silently
      // shrink well below the requested limit.
      let q;
      if (searchTag) {
          const normalizedTag = searchTag.startsWith('#') ? searchTag : `#${searchTag.toLowerCase().replace(/\s+/g, '')}`;
          const queryConstraints: any[] = [
              where("tags", "array-contains", normalizedTag),
              where("isPublic", "==", true),
              orderBy("timestamp", "desc"),
              limit(50)
          ];
          if (lastVisible) {
              queryConstraints.push(startAfter(lastVisible));
          }
          q = query(collection(db, "feed_thumbnails"), ...queryConstraints);
      } else {
          const queryConstraints: any[] = [
              where("isPublic", "==", true),
              orderBy("timestamp", "desc"),
              limit(50)
          ];
          if (lastVisible) {
              queryConstraints.push(startAfter(lastVisible));
          }
          q = query(
              collection(db, "feed_thumbnails"),
              ...queryConstraints
          );
      }

      try {
          let snapshot = await getDocs(q);

          if (snapshot.empty && !lastVisible && !searchTag) {
              await FirebaseService.seedDefaultObservationsIfNeeded();
              snapshot = await getDocs(q);
          }

          let posts: CommunityPost[] = [];
          snapshot.forEach((doc) => {
              const data = doc.data() as any;
              // See subscribeToFeed for why reportStatus stays a
              // client-side check instead of a query filter.
              if (data.reportStatus !== 'pending') {
                  posts.push({
                    id: doc.id,
                    ...data,
                    labels: data.labels || (data.label ? [data.label] : ["Nature"])
                  } as CommunityPost);
              }
          });

          return { posts, lastVisible: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null };
      } catch (error) {
          handleFirestoreError(error, OperationType.GET, "feed_thumbnails");
          throw error;
      }
  },

  subscribeToUserJournal: (userId: string, callback: (posts: CommunityPost[]) => void, onError?: (error: unknown) => void) => {
    const q = query(
        collection(db, "ecosystem_feed"), 
        where("userId", "==", userId)
    );
    return onSnapshot(q, (snapshot) => {
      const posts: CommunityPost[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.isJournal !== false) {
          posts.push({ 
            id: doc.id, 
            ...data,
            labels: data.labels || (data.label ? [data.label] : ["Nature"])
          } as CommunityPost);
        }
      });

      // Sort in memory by timestamp/createdAt descending
      const getT = (docData: any) => {
          const ts = docData.createdAt || docData.timestamp;
          if (!ts) return 0;
          if (ts.toMillis) return ts.toMillis();
          if (ts.seconds) return ts.seconds * 1000;
          if (typeof ts === 'number') return ts;
          return new Date(ts).getTime();
      };

      posts.sort((a: any, b: any) => {
        return getT(b) - getT(a);
      });

      callback(posts);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "ecosystem_feed");
      onError?.(error);
    });
  },

  deletePost: async (postId: string) => {
      let mainFeedSuccess = false;
      try {
          await deleteDoc(doc(db, "ecosystem_feed", postId));
          mainFeedSuccess = true;
      } catch (e) {
          console.warn("Could not delete from ecosystem_feed (might already be deleted or missing rules):", e);
      }
      
      try {
          await deleteDoc(doc(db, "feed_thumbnails", postId));
      } catch (e) {
          console.warn("Could not delete from feed_thumbnails:", e);
          if (!mainFeedSuccess) {
              throw new Error("Failed to delete post from both feed and thumbnails.");
          }
      }
  },

  getPost: async (postId: string): Promise<CommunityPost | null> => {
      const postSnap = await getDoc(doc(db, "ecosystem_feed", postId));
      if (postSnap.exists()) {
          const data = postSnap.data();
          return {
              id: postSnap.id,
              ...data,
              labels: data.labels || (data.label ? [data.label] : ["Nature"])
          } as CommunityPost;
      }
      return null;
  },

  toggleLike: async (postId: string, userId: string, isLiked: boolean) => {
    const postRef = doc(db, "ecosystem_feed", postId);
    await updateDoc(postRef, {
        likes: isLiked ? arrayRemove(userId) : arrayUnion(userId)
    });
    try {
        await updateDoc(doc(db, "feed_thumbnails", postId), {
            likes: isLiked ? arrayRemove(userId) : arrayUnion(userId)
        });
    } catch(e) {}
    
    if (!isLiked) {
      const postSnap = await getDoc(postRef);
      if (postSnap.exists()) {
        const postData = postSnap.data();
        if (postData.userId !== userId) {
          const userProfile = await FirebaseService.getUserProfile(userId);
          await FirebaseService.addNotification(postData.userId, {
            type: 'like',
            message: `${userProfile?.username || 'An explorer'} liked your sighting of ${postData.labels?.[0] || 'Nature'}.`,
            postId,
            senderId: userId,
            senderName: userProfile?.username || 'Explorer'
          });
        }
      }
    }
  },

  // S3: research-grade audio dataset export. Scoped to what's actually
  // buildable without the BigQuery warehouse pipeline (Pillar T2, not
  // built) — a direct Firestore read of community-verified (see Q3
  // confirmIdentification) audio observations, which the caller turns into
  // a downloadable file. "Verified" here specifically means
  // verificationState === 'confirmed' (Q3's promotion threshold), not
  // merely posted — an unverified, possibly-wrong AI label has no place in
  // a dataset meant to support a scientific claim.
  getVerifiedAudioObservations: async (limitCount = 1000): Promise<CommunityPost[]> => {
    const q = query(
      collection(db, "ecosystem_feed"),
      where("mediaType", "==", "audio"),
      where("verificationState", "==", "confirmed"),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
    const snapshot = await getDocs(q);
    const posts: CommunityPost[] = [];
    snapshot.forEach(doc => {
      posts.push({ id: doc.id, ...doc.data() } as CommunityPost);
    });
    return posts;
  },

  // T3: taxonomy backbone. Best-effort, fire-and-forget enrichment run
  // right after a post is created — resolves its freeform labels against
  // GBIF's public taxonomic backbone and writes the result back onto the
  // same post. Never blocks or fails post creation: a resolution failure
  // (network error, no match) just means canonicalTaxa stays unset for
  // that post, same as it always was before this feature existed.
  enrichPostTaxonomy: async (postId: string, labels: string[]): Promise<void> => {
    try {
      const canonicalTaxa = await resolveCanonicalTaxa(labels);
      if (canonicalTaxa.length > 0) {
        await updateDoc(doc(db, "ecosystem_feed", postId), { canonicalTaxa });
      }
    } catch (e) {
      console.warn("Failed to enrich post taxonomy:", e);
    }
  },

  // T4: species map data source. Reuses the existing (isPublic ASC,
  // timestamp DESC) composite index already built for the main feed — no
  // new index needed — then filters client-side for posts that actually
  // carry a geohash (sensitive-species posts never get one, see
  // createObservation/createSessionObservation above). This reads directly
  // from ecosystem_feed rather than the feed_thumbnails cache: the map is
  // a secondary, lower-traffic surface, so it doesn't need the same
  // read-optimization the main feed does.
  getMappableObservations: async (limitCount = 500): Promise<CommunityPost[]> => {
    const q = query(
      collection(db, "ecosystem_feed"),
      where("isPublic", "==", true),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
    const snapshot = await getDocs(q);
    const posts: CommunityPost[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.geohash && data.rawLocation) {
        posts.push({ id: doc.id, ...data } as CommunityPost);
      }
    });
    return posts;
  },

  getFullPost: async (postId: string): Promise<CommunityPost | null> => {
    try {
      const docRef = doc(db, "ecosystem_feed", postId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...docSnap.data() } as CommunityPost;
    } catch (e) {
      console.error("getFullPost failed:", e);
      return null;
    }
  },
  // mediaToRescreen: pass the new media blob whenever an edit actually
  // replaces the published media (not for text-only or rotation-only
  // edits) so the same automated content-safety screen that runs at
  // publish time also covers post-publish media swaps — otherwise an
  // edit could silently replace safe media with unscreened media.
  updatePost: async (postId: string, updates: Partial<CommunityPost>, mediaToRescreen?: Blob | null) => {
      const finalUpdates: Partial<CommunityPost> = { ...updates };
      if (mediaToRescreen) {
          const moderation = await screenPostSafety(mediaToRescreen);
          finalUpdates.reportStatus = moderation.reportStatus;
          finalUpdates.reports = moderation.reports;
      }
      await updateDoc(doc(db, "ecosystem_feed", postId), finalUpdates);
      try {
          const thumbUpdates = { ...finalUpdates };
          delete thumbUpdates.items;
          delete thumbUpdates.imageUrl;
          delete thumbUpdates.videoUrl;
          delete thumbUpdates.audioUrl;
          delete thumbUpdates.originalImageUrl;
          delete thumbUpdates.associatedImageUrls;
          delete thumbUpdates.reports;
          delete thumbUpdates.reportStatus;
          delete thumbUpdates.showLocation;
          delete thumbUpdates.isJournal;
          if (Object.keys(thumbUpdates).length > 0) {
              await updateDoc(doc(db, "feed_thumbnails", postId), thumbUpdates);
          }
      } catch (e) {
          console.warn("Could not update feed_thumbnails:", e);
      }
  }
};
