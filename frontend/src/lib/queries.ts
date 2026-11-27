import { useQuery } from "@tanstack/react-query";
import type { Resume, User } from "@/types";
import { queryClient } from "./queryClient";

/**
 * Data that several screens read, loaded once and shared through the query cache.
 *
 * After changing something on the server, update the cache with setQueryData when
 * the response has the new value, or call invalidate() so the next screen that
 * needs it loads it again. Logging in or out clears everything (clearCache).
 */

const API = import.meta.env.VITE_API_BASE_URL;

// "jds" is a prefix, so invalidating it also refreshes "jds/mine".
export const queryKeys = {
    profile: ["profile"] as const,
    jds: ["jds"] as const,
    myJds: ["jds", "mine"] as const,
    resumes: ["resumes"] as const,
    interviews: ["interviews"] as const,
    leetcode: (username: string) => ["leetcode", username] as const,
    codeforces: (username: string) => ["codeforces", username] as const,
};

type QueryKey = (typeof queryKeys)[Exclude<keyof typeof queryKeys, "leetcode" | "codeforces">];

export const invalidate = (...keys: QueryKey[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

/** Forget every cached answer, so the next user never sees the last one's data. */
export const clearCache = () => queryClient.clear();

async function getJson<T = Record<string, unknown>>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || `Request failed (${res.status})`);
    }
    return data as T;
}

// --- The signed-in user ---

const fetchProfile = async (): Promise<User | null> => {
    const res = await fetch(`${API}/user/profile`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.user) return null; // not signed in
    localStorage.setItem("user", JSON.stringify(data.user));
    return data.user;
};

export const useProfile = () => useQuery({ queryKey: queryKeys.profile, queryFn: fetchProfile });

export const setCachedProfile = (user: User) => {
    queryClient.setQueryData(queryKeys.profile, user);
    localStorage.setItem("user", JSON.stringify(user));
};

// --- Job descriptions: every one the user can pick, and only their uploads ---

export const useJds = <T,>() =>
    useQuery({ queryKey: queryKeys.jds, queryFn: async () => (await getJson<{ jobs?: T[] }>("/jd/")).jobs ?? [] });

export const useMyJds = <T,>() =>
    useQuery({ queryKey: queryKeys.myJds, queryFn: async () => (await getJson<{ jobs?: T[] }>("/jd/user")).jobs ?? [] });

// --- Resumes, as the API returns them (normalize them where they are used) ---

export const resumesQuery = {
    queryKey: queryKeys.resumes,
    queryFn: async () => (await getJson<{ resumes?: Partial<Resume>[] }>("/parser/all")).resumes ?? [],
};

export const useResumes = () => useQuery(resumesQuery);

// --- Saved interviews ---

export const useInterviews = <T,>() =>
    useQuery({
        queryKey: queryKeys.interviews,
        queryFn: async () => (await getJson<{ interviews?: T[] }>("/interview/user")).interviews ?? [],
    });

// --- Public coding profiles. They change slowly, so they stay fresh for 30 minutes ---

const PROFILE_STATS_STALE_MS = 30 * 60 * 1000;

export interface LeetCodeStats {
    totalSolved: number;
    ranking: number;
    easySolved: number;
    totalEasy: number;
    mediumSolved: number;
    totalMedium: number;
    hardSolved: number;
    totalHard: number;
    submissionCalendar?: Record<string, number>;
}

export const useLeetCode = (username: string | undefined) =>
    useQuery({
        queryKey: queryKeys.leetcode(username ?? ""),
        enabled: !!username,
        staleTime: PROFILE_STATS_STALE_MS,
        queryFn: async (): Promise<LeetCodeStats | null> => {
            const res = await fetch(`https://leetcode-api-faisalshohag.vercel.app/${username}`);
            const data = await res.json();
            // The API answers 200 with an error list for unknown users.
            return typeof data.totalSolved === "number" ? data : null;
        },
    });

export const useCodeforces = <User, Change>(username: string) =>
    useQuery({
        queryKey: queryKeys.codeforces(username),
        enabled: !!username,
        staleTime: PROFILE_STATS_STALE_MS,
        queryFn: async (): Promise<{ user: User; history: Change[] }> => {
            const [info, hist] = await Promise.all([
                fetch(`https://codeforces.com/api/user.info?handles=${username}`).then((r) => r.json()),
                fetch(`https://codeforces.com/api/user.rating?handle=${username}`).then((r) => r.json()),
            ]);
            if (info.status !== "OK" || hist.status !== "OK") throw new Error("Codeforces data could not be loaded");
            return { user: info.result[0], history: hist.result.slice(-8) };
        },
    });
