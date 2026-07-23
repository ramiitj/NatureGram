// W2: extracted from firebaseService.ts — one-off/admin-triggered data
// migrations and the empty-feed content seeder. None of these run
// automatically; see AdminConsole.tsx and App.tsx's landing-page fallback
// for the call sites.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  limit,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "../../firebaseConfig";
import { NATURALIST_THEMES } from "../../constants/naturalists";

export const MigrationService = {
  seedThemesMigration: async (): Promise<void> => {
    let processedCount = 0;
    const errors: string[] = [];

    for (const localTheme of NATURALIST_THEMES) {
      const id = localTheme.id;
      const url = localTheme.imageUrl;
      try {
        const docRef = doc(db, 'themes', id);
        
        let firebaseUrl = "";
        if (url) {
            // Theme source images (Unsplash/Wikimedia) already send permissive
            // CORS headers, so this can fetch directly — no proxy hop needed.
            let res: Response | null = null;
            try {
              res = await fetch(url, { cache: 'no-store' });
            } catch (fetchError: any) {
              console.warn(`Fetch failed for theme ${id}:`, fetchError);
            }

            if (res && res.ok) {
               const blob = await res.blob();
               const storageRef = ref(storage, `themes/${id}.jpg`);
               await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
               firebaseUrl = await getDownloadURL(storageRef);
            } else {
               console.warn(`Could not fetch image for theme ${id}, seeding metadata only.`);
            }
        }

        const updatedFields: any = {
          id,
          naturalist: localTheme.naturalist || "",
          quote: localTheme.quote || "",
          locationName: localTheme.locationName || "",
          locationCaption: localTheme.locationCaption || "",
          colors: localTheme.colors || null,
          updatedAt: new Date().toISOString()
        };
        if (firebaseUrl) {
          updatedFields.imageUrl = firebaseUrl;
        }

        await setDoc(docRef, updatedFields, { merge: true });
        processedCount++;
      } catch (e: any) {
        console.error(`Failed to seed theme ${id}:`, e);
        errors.push(`${id}: ${e.message}`);
      }
    }
    
    if (processedCount === 0) {
      throw new Error(`Theme seeding failed completely! Details:\n${errors.slice(0, 3).join('\n')}`);
    }
    
    if (errors.length > 0) {
      console.warn(`Theme seeding finished with partial failures: ${errors.length} errors`);
    }
  },

  runThumbnailMigration: async () => {
    if (!auth.currentUser) return 0;
    try {
        const q = query(collection(db, "ecosystem_feed"), where("isPublic", "==", true));
        const feedSnap = await getDocs(q);
        let count = 0;
        for (const docSnap of feedSnap.docs) {
            const data = docSnap.data();
            if (data.isPublic) {
                const id = docSnap.id;
                const thumbRef = doc(db, "feed_thumbnails", id);
                const thumbSnap = await getDoc(thumbRef);
                
                if (!thumbSnap.exists()) {
                    const thumbData = {
                        id,
                        mediaType: data.mediaType || data.type || 'image',
                        thumbnailUrl: data.thumbnailUrl || data.imageUrl || "",
                        title: data.title || null,
                        description: data.description || null,
                        timestamp: data.timestamp || null,
                        userId: data.userId || null,
                        userName: data.userName || null,
                        likes: data.likes || [],
                        commentCount: data.commentCount || 0,
                        isPublic: true,
                        tags: data.tags || [],
                        labels: data.labels || [],
                        behavior: data.behavior || null,
                        aiInsight: data.aiInsight || null,
                        locationArea: data.locationArea || null,
                        isHybrid: data.isHybrid || false
                    };
                    
                    await setDoc(thumbRef, thumbData);
                    count++;
                }
            }
        }
        return count;
    } catch (e) {
        console.warn("Migration failed:", e);
        throw e;
    }
  },

  seedDefaultObservationsIfNeeded: async (): Promise<void> => {
    try {
      const q = query(collection(db, "feed_thumbnails"), limit(5));
      const snap = await getDocs(q);
      if (snap.size >= 3) {
        return; // Content density is healthy; skip seeding
      }
      
      console.log("Low density or no observations found in feed_thumbnails. Seeding default observations...");
      
      const seedItems = [
        {
          id: "seed_goodall_1",
          userId: "system_seeder_goodall",
          userName: "Jane Goodall",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Gombe_Stream_NP_Mutter_und_Kind.jpg/1280px-Gombe_Stream_NP_Mutter_und_Kind.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Gombe_Stream_NP_Mutter_und_Kind.jpg/1280px-Gombe_Stream_NP_Mutter_und_Kind.jpg",
          mediaType: "image",
          labels: ["Chimpanzee", "Primate", "Hominidae"],
          behavior: "Observed mother chimpanzee protective behavior with infant in the lush forests of Gombe. Fascinating social hierarchy dynamics.",
          aiInsight: "This high-fidelity sighting confirms a strong emotional and physical bond between primate mother and offspring, showcasing mutual grooming and behavioral feedback loops.",
          locationArea: "Gombe Stream, Tanzania",
          showLocation: true,
          tags: ["#chimpanzee", "#primate", "#gombe", "#wildlife"],
          timestamp: new Date(Date.now() - 3600000 * 5), // 5 hours ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_fossey_1",
          userId: "system_seeder_fossey",
          userName: "Dian Fossey",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Virunga_National_Park_Landscape.jpg/1280px-Virunga_National_Park_Landscape.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Virunga_National_Park_Landscape.jpg/1280px-Virunga_National_Park_Landscape.jpg",
          mediaType: "image",
          labels: ["Mountain Gorilla", "Silverback", "Primates"],
          behavior: "Observed an adult Silverback Mountain Gorilla maintaining a defensive posture while feeding on celery stalks in dense foliage.",
          aiInsight: "Sighting of key sentinel silverback gorilla signaling group boundaries and territory cohesion in the bamboo zone of the Virungas.",
          locationArea: "Virunga Mountains, Rwanda",
          showLocation: true,
          tags: ["#gorilla", "#silverback", "#virunga", "#primates"],
          timestamp: new Date(Date.now() - 3600000 * 12), // 12 hours ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_darwin_1",
          userId: "system_seeder_darwin",
          userName: "Charles Darwin",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG/1280px-Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG/1280px-Lobo_marino_%28Zalophus_californianus_wollebaeki%29%2C_Punta_Pitt%2C_isla_de_San_Crist%C3%B3bal%2C_islas_Gal%C3%A1pagos%2C_Ecuador%2C_2015-07-24%2C_DD_11.JPG",
          mediaType: "image",
          labels: ["Galapagos Sea Lion", "Otariidae", "Marine Mammal"],
          behavior: "Sighted Galapagos sea lion resting on volcanic stones at Punta Pitt. Exibits remarkable thermal dissipation adaptations.",
          aiInsight: "Sea lion hauling-out behavior on volcanic shoreline illustrates adaptive thermoregulation in micro-climate coastal conditions.",
          locationArea: "Galápagos Islands, Ecuador",
          showLocation: true,
          tags: ["#sealion", "#galapagos", "#evolution", "#marinelife"],
          timestamp: new Date(Date.now() - 3600000 * 24), // 24 hours ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_attenborough_1",
          userId: "system_seeder_attenborough",
          userName: "David Attenborough",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Serengeti_National_Park_-_Zebras_01.jpg/1280px-Serengeti_National_Park_-_Zebras_01.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Serengeti_National_Park_-_Zebras_01.jpg/1280px-Serengeti_National_Park_-_Zebras_01.jpg",
          mediaType: "image",
          labels: ["Plains Zebra", "Equidae", "Ungulate"],
          behavior: "A small herd of Plains Zebras grazing peacefully of fresh grass shoots during the Great Migration cycle across the grassland plains.",
          aiInsight: "Zebra striping mechanisms serve both social cohesion and motion-dazzle camouflage against predators under direct sunlight.",
          locationArea: "Serengeti, Tanzania",
          showLocation: true,
          tags: ["#zebra", "#serengeti", "#greatmigration", "#savannah"],
          timestamp: new Date(Date.now() - 3600000 * 48), // 2 days ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        },
        {
          id: "seed_cousteau_1",
          userId: "system_seeder_cousteau",
          userName: "Jacques-Yves Cousteau",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Coral_reef_in_the_Red_Sea.jpg/1280px-Coral_reef_in_the_Red_Sea.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Coral_reef_in_the_Red_Sea.jpg/1280px-Coral_reef_in_the_Red_Sea.jpg",
          mediaType: "image",
          labels: ["Acropora Coral", "Coral Reef", "Scleractinia"],
          behavior: "Explored an extremely healthy and vibrant coral reef system. High density of diverse colorful reef fish and massive coral heads.",
          aiInsight: "Red Sea coral reef systems show anomalous thermal tolerance, serving as a critical genetic refuge against rising global sea temperatures.",
          locationArea: "The Red Sea",
          showLocation: true,
          tags: ["#coral", "#coralreef", "#redsea", "#divers"],
          timestamp: new Date(Date.now() - 3600000 * 72), // 3 days ago
          likes: [],
          commentCount: 0,
          isPublic: true,
          isJournal: true,
          reportStatus: "safe",
          reports: [],
          isHybrid: false
        }
      ];

      for (const item of seedItems) {
        const postDocRef = doc(db, "ecosystem_feed", item.id);
        const thumbDocRef = doc(db, "feed_thumbnails", item.id);
        
        let sampleItemsList = [
          {
            imageUrl: item.imageUrl,
            thumbnailUrl: item.thumbnailUrl,
            originalImageUrl: item.imageUrl,
            mediaType: item.mediaType as 'image' | 'video' | 'audio',
            labels: item.labels,
            behavior: item.behavior,
            aiInsight: item.aiInsight,
            locationArea: item.locationArea,
            showLocation: item.showLocation,
            rotation: 0
          }
        ];
        
        const fullPostData = {
          userId: item.userId,
          userName: item.userName,
          imageUrl: item.imageUrl,
          thumbnailUrl: item.thumbnailUrl,
          originalImageUrl: item.imageUrl,
          mediaType: item.mediaType,
          labels: item.labels,
          behavior: item.behavior,
          aiInsight: item.aiInsight,
          locationArea: item.locationArea,
          showLocation: item.showLocation,
          tags: item.tags,
          timestamp: item.timestamp,
          likes: item.likes,
          commentCount: item.commentCount,
          isPublic: item.isPublic,
          isJournal: item.isJournal,
          reportStatus: item.reportStatus,
          reports: item.reports,
          isHybrid: item.isHybrid,
          items: sampleItemsList
        };

        const thumbData = {
          id: item.id,
          mediaType: item.mediaType as 'image' | 'video' | 'audio',
          thumbnailUrl: item.thumbnailUrl,
          timestamp: item.timestamp,
          userId: item.userId,
          userName: item.userName,
          likes: item.likes,
          commentCount: item.commentCount,
          isPublic: item.isPublic,
          tags: item.tags,
          labels: item.labels,
          behavior: item.behavior,
          aiInsight: item.aiInsight,
          locationArea: item.locationArea,
          isHybrid: item.isHybrid
        };

        await setDoc(postDocRef, fullPostData);
        await setDoc(thumbDocRef, thumbData);
      }
      console.log("Seeded 5 default observations successfully into Firestore!");
    } catch (e) {
      console.warn("Skipped seeding observations:", e);
    }
  },
};
