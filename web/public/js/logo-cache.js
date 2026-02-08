/**
 * DAB+ Radio Streamer — Station Logo Cache
 *
 * In-memory cache of station logos (MOT/slideshow images) keyed by SID.
 * Stores blob URLs for instant display. Shared by nowplaying.js and channels.js.
 *
 * The API server maintains a persistent disk cache (/data/logos/) so that logos
 * survive browser refreshes and container restarts. This frontend cache avoids
 * repeated network requests within the same browser session.
 */

const cache = new Map(); // SID string -> { blobUrl: string, loading: Promise|null }
const failedAt = new Map(); // SID string -> timestamp of last failed fetch

const RETRY_COOLDOWN = 5000; // ms before retrying a failed fetch

/**
 * Get a cached logo blob URL for the given SID, or null if not cached.
 * @param {string|number} sid
 * @returns {string|null} blob URL
 */
export function getCachedLogo(sid) {
    const entry = cache.get(String(sid));
    return (entry && entry.blobUrl) ? entry.blobUrl : null;
}

/**
 * Fetch and cache the logo for the given SID.
 * Returns the blob URL on success, or null if the fetch fails (404, network error).
 * Deduplicates in-flight requests for the same SID.
 * @param {string|number} sid
 * @returns {Promise<string|null>} blob URL or null
 */
export async function fetchAndCacheLogo(sid) {
    const key = String(sid);
    const existing = cache.get(key);
    if (existing && existing.blobUrl) return existing.blobUrl;
    if (existing && existing.loading) return existing.loading;

    return doFetch(key);
}

/**
 * Retry fetching a logo if it previously failed and enough time has passed.
 * Returns the blob URL on success, or null if still failing or in cooldown.
 * Use this for periodic retry of the currently playing station's logo.
 * @param {string|number} sid
 * @returns {Promise<string|null>} blob URL or null
 */
export async function retryLogo(sid) {
    const key = String(sid);

    // Already cached — no retry needed
    if (getCachedLogo(key)) return getCachedLogo(key);

    // Check cooldown — don't hammer the server
    const lastFail = failedAt.get(key);
    if (lastFail && (Date.now() - lastFail) < RETRY_COOLDOWN) {
        return null;
    }

    return doFetch(key);
}

/**
 * Invalidate the cached logo for a SID and re-fetch it.
 * Used when MOT changes (e.g. station sends new slideshow image).
 * @param {string|number} sid
 * @returns {Promise<string|null>} new blob URL or null
 */
export async function refreshLogo(sid) {
    const key = String(sid);

    // Revoke old blob URL to free memory
    const existing = cache.get(key);
    if (existing && existing.blobUrl) {
        URL.revokeObjectURL(existing.blobUrl);
    }
    cache.delete(key);
    failedAt.delete(key);

    return doFetch(key);
}

/**
 * Internal: perform the actual fetch, deduplicating in-flight requests.
 */
function doFetch(key) {
    const existing = cache.get(key);
    if (existing && existing.loading) return existing.loading;

    const loading = (async () => {
        try {
            const res = await fetch(`/slide/${key}`);
            if (!res.ok) {
                failedAt.set(key, Date.now());
                cache.delete(key);
                return null;
            }
            const blob = await res.blob();
            if (blob.size === 0) {
                failedAt.set(key, Date.now());
                cache.delete(key);
                return null;
            }
            // Defensively revoke any stale blob URL before creating a new one
            const prev = cache.get(key);
            if (prev && prev.blobUrl) {
                URL.revokeObjectURL(prev.blobUrl);
            }
            const blobUrl = URL.createObjectURL(blob);
            cache.set(key, { blobUrl, loading: null });
            failedAt.delete(key);
            return blobUrl;
        } catch {
            failedAt.set(key, Date.now());
            cache.delete(key);
            return null;
        }
    })();

    cache.set(key, { blobUrl: null, loading });
    return loading;
}
