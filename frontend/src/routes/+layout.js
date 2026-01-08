// Prerender all pages for static IPFS deployment
export const prerender = true;

// Disable SSR since we're deploying to IPFS (client-side only)
export const ssr = false;

// Use client-side routing for SPA behavior
export const trailingSlash = 'always';
