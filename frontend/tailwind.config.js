/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				chess: {
					dark: '#1a1a2e',
					darker: '#0f0f1a',
					accent: '#e4a853',
					'accent-hover': '#f0b860',
					light: '#f5f5f5',
					gray: '#6b7280',
					success: '#22c55e',
					danger: '#ef4444',
					blue: '#3b82f6',
					purple: '#a855f7'
				}
			},
			fontFamily: {
				display: ['Cinzel', 'serif'],
				body: ['Inter', 'sans-serif']
			}
		}
	},
	plugins: []
};
