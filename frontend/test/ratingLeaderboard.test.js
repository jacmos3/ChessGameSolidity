import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRatingEntries, sortRatingEntries } from '../src/lib/utils/ratingLeaderboard.js';

test('rating pagination considers players beyond the first insertion-order page', async () => {
	const players = Array.from({ length: 121 }, (_, index) => ({
		address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
		rating: index === 120 ? 3000 : 1200 + (index % 10)
	}));
	let activeCalls = 0;
	let maximumConcurrency = 0;
	const contract = {
		async getTopPlayers(offset, limit) {
			activeCalls += 1;
			maximumConcurrency = Math.max(maximumConcurrency, activeCalls);
			await Promise.resolve();
			const page = players.slice(offset, offset + limit);
			activeCalls -= 1;
			return {
				addresses: page.map(player => player.address),
				ratings: page.map(player => player.rating)
			};
		}
	};

	const entries = await fetchAllRatingEntries(contract, players.length, {
		pageSize: 25,
		pageConcurrency: 3
	});
	const leaders = sortRatingEntries(entries).slice(0, 20);

	assert.equal(entries.length, players.length);
	assert.equal(leaders[0].address, players[120].address);
	assert.ok(maximumConcurrency <= 3);
});

test('rating pagination fails closed on an incomplete page', async () => {
	const contract = {
		async getTopPlayers() {
			return { addresses: [], ratings: [] };
		}
	};
	await assert.rejects(fetchAllRatingEntries(contract, 1), /Incomplete rating page/);
});
