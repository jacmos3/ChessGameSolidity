// Static adapter configuration for IPFS/Unstoppable Domains deployment
// This makes the entire app a client-side SPA

// Disable server-side rendering - everything runs in the browser
export const ssr = false;

// Enable prerendering for static HTML generation
export const prerender = true;

// Allow trailing slashes for better IPFS compatibility
export const trailingSlash = 'always';
