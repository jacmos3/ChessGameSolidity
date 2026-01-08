import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// Output directory for the static build
			pages: 'build',
			assets: 'build',
			// Fallback page for SPA routing on IPFS
			fallback: 'index.html',
			// Precompress with gzip/brotli
			precompress: false,
			// Strict mode off for dynamic routes
			strict: false
		}),
		// Use relative paths for IPFS compatibility
		paths: {
			base: '',
			relative: true
		}
	}
};

export default config;
