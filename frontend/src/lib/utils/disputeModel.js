export const Vote = Object.freeze({
	None: 0,
	Legit: 1,
	WhiteCheat: 2,
	BlackCheat: 3,
	Abstain: 4
});

const VALID_ARBITRATOR_VOTES = new Set([
	Vote.Legit,
	Vote.WhiteCheat,
	Vote.BlackCheat,
	Vote.Abstain
]);

export function isValidArbitratorVote(vote) {
	return VALID_ARBITRATOR_VOTES.has(Number(vote));
}

export function isCheatDecision(vote) {
	const normalized = Number(vote);
	return normalized === Vote.WhiteCheat || normalized === Vote.BlackCheat;
}

export function isChallengeableGameState(state) {
	// ChessCore.getGameState() is deliberately 1-indexed for the UI:
	// 2=InProgress, 3=Draw, 4=WhiteWins, 5=BlackWins.
	return [3, 4, 5].includes(Number(state));
}

export function getVoteLabel(vote) {
	switch (Number(vote)) {
		case Vote.None: return 'No Vote';
		case Vote.Legit: return 'Legitimate';
		case Vote.WhiteCheat: return 'White Cheated';
		case Vote.BlackCheat: return 'Black Cheated';
		case Vote.Abstain: return 'Abstain';
		default: return 'Unknown';
	}
}
