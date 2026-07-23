// W2: extracted from firebaseService.ts — comment creation/reads on a post.
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { Comment } from "../../types";
import { handleFirestoreError, OperationType } from "./shared";
import { FirebaseService } from "../firebaseService";

export const CommentsService = {
  addComment: async (postId: string, userId: string, text: string) => {
    const userProfile = await FirebaseService.getUserProfile(userId);
    const userName = userProfile?.username || auth.currentUser?.displayName || `Explorer-${userId.slice(0, 4)}`;
    const commentsRef = collection(db, "ecosystem_feed", postId, "comments");
    await addDoc(commentsRef, {
        userId,
        userName,
        text,
        timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "ecosystem_feed", postId), { commentCount: increment(1) });
    try {
        await updateDoc(doc(db, "feed_thumbnails", postId), { commentCount: increment(1) });
    } catch(e) {}

    const postRef = doc(db, "ecosystem_feed", postId);
    const postSnap = await getDoc(postRef);
    if (postSnap.exists()) {
      const postData = postSnap.data();
      if (postData.userId !== userId) {
        await FirebaseService.addNotification(postData.userId, {
          type: 'comment',
          message: `${userName} left a field note on your sighting.`,
          postId,
          senderId: userId,
          senderName: userName
        });
      }
    }
  },

  subscribeToComments: (postId: string, callback: (comments: Comment[]) => void) => {
    const q = query(collection(db, "ecosystem_feed", postId, "comments"), orderBy("timestamp", "asc"));
    return onSnapshot(q, (snapshot) => {
        const comments: Comment[] = [];
        snapshot.forEach(doc => comments.push({ id: doc.id, ...doc.data() } as Comment));
        callback(comments);
    }, (error) => {
        handleFirestoreError(error, OperationType.GET, `ecosystem_feed/${postId}/comments`);
    });
  },
};
