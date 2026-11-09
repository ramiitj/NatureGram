export interface UserRateLimits {
    date: string;
    observation_sessions: number;
    conversation_sessions: number;
    upload_hits: number;
    upload_files_total: number;
}

export const RateLimitService = {
    getLimits(userId: string): UserRateLimits {
        const today = new Date().toISOString().split('T')[0];
        const key = `rate_limits_${userId}`;
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed: UserRateLimits = JSON.parse(stored);
            if (parsed.date === today) {
                return parsed;
            }
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
        localStorage.setItem(key, JSON.stringify(limits));
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
        localStorage.setItem('active_session_heartbeat', Date.now().toString());
    },
    
    isSessionActive(): boolean {
        const heartbeat = localStorage.getItem('active_session_heartbeat');
        if (!heartbeat) return false;
        // If last ping was less than 10 seconds ago, it's active
        return (Date.now() - parseInt(heartbeat, 10)) < 10000;
    },
    
    clearSessionActive() {
        localStorage.removeItem('active_session_heartbeat');
    }
};
