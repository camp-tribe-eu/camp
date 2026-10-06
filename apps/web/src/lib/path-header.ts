/**
 * How the requested path reaches the 404 page. CAMP-235.
 *
 * 🔴 Its own file so that the middleware and the page can share it
 * without the page importing the middleware — which would pull the gone
 * list and the redirect map into a bundle that needs neither.
 *
 * A server component cannot otherwise learn the path it was rendered
 * for: `headers()` exposes no pathname, and Next's internal
 * `x-invoke-path` is not an API and not a promise.
 */
export const PATH_HEADER = 'x-ct-path';
