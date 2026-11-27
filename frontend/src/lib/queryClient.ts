import { QueryClient } from "@tanstack/react-query";

/**
 * One cache for the whole app. Data loaded on one screen is reused on the next,
 * so switching tabs does not ask the API again. A result counts as fresh for
 * 5 minutes; after that it is shown at once and refreshed in the background.
 * Screens that change data update or invalidate the matching entry (see queries.ts).
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});
