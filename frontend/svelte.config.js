import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// Output directory for the static build
			pages: 'build',
			assets: 'build',
			// Fallback page for SPA routing (handles dynamic routes like /game/[address])
			fallback: 'index.html',
			// Strict mode off to allow fallback
			strict: false
		}),
		// Use relative paths for IPFS compatibility
		paths: {
			relative: true
		}
	}
};

export default config;
