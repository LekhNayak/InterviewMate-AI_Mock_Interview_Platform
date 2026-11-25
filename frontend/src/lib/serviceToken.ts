const API = import.meta.env.VITE_API_BASE_URL;

let cached: { token: string; expiresAt: number } | null = null;

/**
 * Authorization header for the interview and emotion services.
 * Empty when the backend does not issue tokens, in which case the services do not ask for one.
 */
export const serviceAuthHeaders = async (): Promise<Record<string, string>> => {
    if (!cached || cached.expiresAt < Date.now() + 60_000) {
        cached = null;
        try {
            const res = await fetch(`${API}/user/service-token`, { credentials: "include" });
            const data = await res.json();
            if (res.ok && data.token) {
                cached = { token: data.token, expiresAt: Date.now() + data.expiresIn * 1000 };
            }
        } catch (err) {
            console.error("Could not get a service token:", err);
        }
    }
    return cached ? { Authorization: `Bearer ${cached.token}` } : {};
};

/** Forget the token, for example on logout. */
export const clearServiceToken = () => {
    cached = null;
};
