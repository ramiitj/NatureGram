export interface UserRateLimits {
    date: string;
    observation_sessions: number;
    conversation_sessions: number;
    upload_hits: number;
    upload_files_total: number;
}

/** Said when this device's guard on identifications is reached (the same words as the server's allowance). */
export const IDENTIFICATIONS_USED_MESSAGE = "You've used today's identifications. You can still add sightings and name them yourself.";

/**
 * A light, per-device guard in front of the server's own daily allowances (the server decides).
 * Storage can be blocked (private windows, strict settings): every read and write is wrapped, so a
 * blocked store only means no guard, never a Lens that won't open.
 */
const readStore = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStore = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };
const removeStore = (key: string) => { try { localStorage.removeItem(key); } catch { /* storage blocked */ } };

export const RateLimitService = {
    getLimits(userId: string): UserRateLimits {
        const today = new Date().toISOString().split('T')[0];
        const key = `rate_limits_${userId}`;
        const stored = readStore(key);
        if (stored) {
            try {
                const parsed: UserRateLimits = JSON.parse(stored);
                if (parsed && parsed.date === today) {
                    return parsed;
                }
            } catch { /* unreadable: start the day afresh */ }
        }
        return {
            date: today,
            observation_sessions: 0,
            conversation_sessions: 0,
            upload_hits: 0,
            upload_files_total: 0
        };
    },

    saveLimits(userId: string, limits: UserRateLimits) {
        const key = `rate_limits_${userId}`;
        writeStore(key, JSON.stringify(limits));
    },

    canStartObservation(userId: string): boolean {
        const limits = this.getLimits(userId);
        return limits.observation_sessions < 3;
    },
    
    incrementObservation(userId: string) {
        const limits = this.getLimits(userId);
        limits.observation_sessions++;
        this.saveLimits(userId, limits);
    },

    canStartConversation(userId: string): boolean {
        const limits = this.getLimits(userId);
        return limits.conversation_sessions < 3;
    },

    incrementConversation(userId: string) {
        const limits = this.getLimits(userId);
        limits.conversation_sessions++;
        this.saveLimits(userId, limits);
    },

    /** Identifications for camera-roll files: 3 batches or 15 files a day on this device. */
    canUpload(userId: string, numFiles: number): boolean {
        const limits = this.getLimits(userId);
        if (limits.upload_hits >= 3) return false;
        if (limits.upload_files_total + numFiles > 15) return false;
        return true;
    },

    incrementUpload(userId: string, numFiles: number) {
        const limits = this.getLimits(userId);
        limits.upload_hits++;
        limits.upload_files_total += numFiles;
        this.saveLimits(userId, limits);
    },
    
    // Heartbeat logic to prevent stuck sessions if tab is closed
    pingSessionActive() {
        writeStore('active_session_heartbeat', Date.now().toString());
    },
    
    isSessionActive(): boolean {
        const heartbeat = readStore('active_session_heartbeat');
        if (!heartbeat) return false;
        // If last ping was less than 10 seconds ago, it's active
        return (Date.now() - parseInt(heartbeat, 10)) < 10000;
    },
    
    clearSessionActive() {
        removeStore('active_session_heartbeat');
    }
};
