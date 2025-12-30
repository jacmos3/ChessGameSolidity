import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

// Notification settings store
export const notificationSettings = writable({
	enabled: false,
	permission: 'default' // 'default', 'granted', 'denied'
});

// Initialize from localStorage and check current permission
if (browser) {
	try {
		const saved = localStorage.getItem('chess-notification-settings');
		if (saved) {
			const parsed = JSON.parse(saved);
			notificationSettings.set({
				...parsed,
				permission: Notification.permission
			});
		} else {
			notificationSettings.update(s => ({
				...s,
				permission: Notification.permission
			}));
		}
	} catch (e) {
		console.warn('Could not load notification settings:', e);
	}

	// Save settings changes to localStorage
	notificationSettings.subscribe(value => {
		try {
			localStorage.setItem('chess-notification-settings', JSON.stringify(value));
		} catch (e) {
			console.warn('Could not save notification settings:', e);
		}
	});
}

// Request notification permission
export async function requestNotificationPermission() {
	if (!browser || !('Notification' in window)) {
		return false;
	}

	try {
		const permission = await Notification.requestPermission();
		notificationSettings.update(s => ({
			...s,
			permission,
			enabled: permission === 'granted'
		}));
		return permission === 'granted';
	} catch (e) {
		console.warn('Could not request notification permission:', e);
		return false;
	}
}

// Toggle notifications on/off
export async function toggleNotifications() {
	const settings = get(notificationSettings);

	if (!settings.enabled) {
		// Trying to enable - need permission
		if (settings.permission !== 'granted') {
			const granted = await requestNotificationPermission();
			if (!granted) return false;
		}
		notificationSettings.update(s => ({ ...s, enabled: true }));
		return true;
	} else {
		// Disabling
		notificationSettings.update(s => ({ ...s, enabled: false }));
		return false;
	}
}

// Send a notification
export function sendNotification(title, options = {}) {
	if (!browser || !('Notification' in window)) return null;

	const settings = get(notificationSettings);
	if (!settings.enabled || settings.permission !== 'granted') return null;

	// Don't notify if window is focused
	if (document.hasFocus()) return null;

	try {
		const notification = new Notification(title, {
			icon: '/favicon.svg',
			badge: '/favicon.svg',
			tag: options.tag || 'chess-game',
			renotify: options.renotify || false,
			...options
		});

		// Auto-close after 10 seconds
		setTimeout(() => notification.close(), 10000);

		// Focus window on click
		notification.onclick = () => {
			window.focus();
			notification.close();
			if (options.onClick) options.onClick();
		};

		return notification;
	} catch (e) {
		console.warn('Could not send notification:', e);
		return null;
	}
}

// Notify when it's the user's turn
export function notifyYourTurn(gameAddress) {
	return sendNotification('Your Turn!', {
		body: 'Your opponent made a move. It\'s your turn to play.',
		tag: `turn-${gameAddress}`,
		renotify: true
	});
}

// Notify when game ends
export function notifyGameEnd(result, gameAddress) {
	const messages = {
		win: { title: 'Victory!', body: 'Congratulations! You won the game.' },
		lose: { title: 'Game Over', body: 'You lost the game. Better luck next time!' },
		draw: { title: 'Draw', body: 'The game ended in a draw.' }
	};

	const msg = messages[result] || messages.draw;
	return sendNotification(msg.title, {
		body: msg.body,
		tag: `end-${gameAddress}`,
		renotify: true
	});
}

// Notify opponent joined
export function notifyOpponentJoined(gameAddress) {
	return sendNotification('Game Started!', {
		body: 'An opponent has joined your game. The match begins!',
		tag: `joined-${gameAddress}`,
		renotify: true
	});
}

// Notify low time warning
export function notifyLowTime(timeRemaining) {
	return sendNotification('Low Time Warning!', {
		body: `You have ${timeRemaining} remaining. Make your move!`,
		tag: 'low-time',
		renotify: false
	});
}
