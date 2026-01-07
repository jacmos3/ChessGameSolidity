import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const ONBOARDING_KEY = 'chess-onboarding-completed';

// Onboarding steps
export const ONBOARDING_STEPS = [
	{
		id: 'welcome',
		title: 'Welcome to Solidity Chess!',
		content: 'Play chess on the blockchain. Every move is recorded on-chain, and winners can mint victory NFTs.',
		target: null
	},
	{
		id: 'create-game',
		title: 'Create a Game',
		content: 'Start a new game by choosing your bet amount and time control. Your opponent will need to match your bet to join.',
		target: '[data-tour="create-game"]'
	},
	{
		id: 'join-game',
		title: 'Join Open Games',
		content: 'Or join an existing game from the lobby. Browse available games and pick one that matches your preferred stakes.',
		target: '[data-tour="open-games"]'
	},
	{
		id: 'play',
		title: 'Play Your Moves',
		content: 'Click on a piece to see legal moves highlighted in green. Click the destination square to make your move.',
		target: null
	},
	{
		id: 'timer',
		title: 'Watch the Clock',
		content: 'Each player has limited time based on the game\'s time control. If time runs out, your opponent can claim victory.',
		target: null
	},
	{
		id: 'gas',
		title: 'Gas Costs',
		content: 'Each move costs gas. Check the estimated gas cost before making your move.',
		target: null
	}
];

function createOnboardingStore() {
	const completed = browser ? localStorage.getItem(ONBOARDING_KEY) === 'true' : false;

	const { subscribe, set, update } = writable({
		isActive: false,
		currentStep: 0,
		completed
	});

	return {
		subscribe,

		start() {
			update(s => ({ ...s, isActive: true, currentStep: 0 }));
		},

		next() {
			update(s => {
				const nextStep = s.currentStep + 1;
				if (nextStep >= ONBOARDING_STEPS.length) {
					return { ...s, isActive: false, currentStep: 0, completed: true };
				}
				return { ...s, currentStep: nextStep };
			});
		},

		prev() {
			update(s => ({
				...s,
				currentStep: Math.max(0, s.currentStep - 1)
			}));
		},

		skip() {
			update(s => ({ ...s, isActive: false, completed: true }));
			if (browser) {
				localStorage.setItem(ONBOARDING_KEY, 'true');
			}
		},

		complete() {
			update(s => ({ ...s, isActive: false, completed: true }));
			if (browser) {
				localStorage.setItem(ONBOARDING_KEY, 'true');
			}
		},

		reset() {
			set({ isActive: false, currentStep: 0, completed: false });
			if (browser) {
				localStorage.removeItem(ONBOARDING_KEY);
			}
		}
	};
}

export const onboarding = createOnboardingStore();
