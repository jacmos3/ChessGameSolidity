import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

// Sound URLs (using Lichess open-source sounds)
const SOUND_URLS = {
	move: 'https://lichess1.org/assets/sound/standard/Move.ogg',
	capture: 'https://lichess1.org/assets/sound/standard/Capture.ogg',
	check: 'https://lichess1.org/assets/sound/standard/GenericNotify.ogg',
	castle: 'https://lichess1.org/assets/sound/standard/Move.ogg',
	promote: 'https://lichess1.org/assets/sound/standard/Move.ogg',
	gameStart: 'https://lichess1.org/assets/sound/standard/GenericNotify.ogg',
	gameEnd: 'https://lichess1.org/assets/sound/standard/GenericNotify.ogg',
	lowTime: 'https://lichess1.org/assets/sound/standard/LowTime.ogg',
	victory: 'https://lichess1.org/assets/sound/standard/GenericNotify.ogg',
	defeat: 'https://lichess1.org/assets/sound/standard/GenericNotify.ogg',
	yourTurn: 'https://lichess1.org/assets/sound/standard/GenericNotify.ogg'
};

// Audio cache
const audioCache = new Map();

// Settings store
export const audioSettings = writable({
	enabled: true,
	volume: 0.7
});

// Initialize settings from localStorage
if (browser) {
	try {
		const saved = localStorage.getItem('chess-audio-settings');
		if (saved) {
			audioSettings.set(JSON.parse(saved));
		}
	} catch (e) {
		console.warn('Could not load audio settings:', e);
	}

	// Save settings changes to localStorage
	audioSettings.subscribe(value => {
		try {
			localStorage.setItem('chess-audio-settings', JSON.stringify(value));
		} catch (e) {
			console.warn('Could not save audio settings:', e);
		}
	});
}

// Preload sounds
async function preloadSound(name) {
	if (!browser) return null;

	const url = SOUND_URLS[name];
	if (!url) return null;

	if (audioCache.has(name)) {
		return audioCache.get(name);
	}

	try {
		const audio = new Audio(url);
		audio.preload = 'auto';
		await new Promise((resolve, reject) => {
			audio.oncanplaythrough = resolve;
			audio.onerror = reject;
			// Timeout after 5 seconds
			setTimeout(reject, 5000);
		});
		audioCache.set(name, audio);
		return audio;
	} catch (e) {
		console.warn(`Could not preload sound ${name}:`, e);
		return null;
	}
}

// Play a sound
export async function playSound(name) {
	if (!browser) return;

	const settings = get(audioSettings);
	if (!settings.enabled) return;

	try {
		let audio = audioCache.get(name);

		if (!audio) {
			audio = await preloadSound(name);
		}

		if (audio) {
			// Clone to allow overlapping sounds
			const clone = audio.cloneNode();
			clone.volume = settings.volume;
			await clone.play();
		}
	} catch (e) {
		// Ignore autoplay restrictions, etc.
		console.debug('Could not play sound:', e);
	}
}

// Preload all sounds on first interaction
let hasPreloaded = false;

export function preloadAllSounds() {
	if (hasPreloaded || !browser) return;
	hasPreloaded = true;

	Object.keys(SOUND_URLS).forEach(name => {
		preloadSound(name);
	});
}

// Toggle sound on/off
export function toggleSound() {
	audioSettings.update(s => ({ ...s, enabled: !s.enabled }));
}

// Set volume (0-1)
export function setVolume(volume) {
	audioSettings.update(s => ({ ...s, volume: Math.max(0, Math.min(1, volume)) }));
}

// Play sound for a chess move
export function playMoveSound(options = {}) {
	const { isCapture, isCheck, isMate, isCastle, isPromotion } = options;

	if (isMate) {
		playSound('gameEnd');
	} else if (isCheck) {
		playSound('check');
	} else if (isCapture) {
		playSound('capture');
	} else if (isCastle) {
		playSound('castle');
	} else if (isPromotion) {
		playSound('promote');
	} else {
		playSound('move');
	}
}
