const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_PAGE_CONCURRENCY = 5;

function normalizeCount(value, label) {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(`${label} is not a safe non-negative integer`);
	}
	return count;
}

export function sortRatingEntries(entries) {
	return [...entries].sort((a, b) => {
		if (b.rating !== a.rating) return b.rating - a.rating;
		return a.address.toLowerCase().localeCompare(b.address.toLowerCase());
	});
}

export async function fetchAllRatingEntries(
	contract,
	totalPlayers,
	{ pageSize = DEFAULT_PAGE_SIZE, pageConcurrency = DEFAULT_PAGE_CONCURRENCY } = {}
) {
	const total = normalizeCount(totalPlayers, 'Ranked player count');
	const size = normalizeCount(pageSize, 'Rating page size');
	const concurrency = normalizeCount(pageConcurrency, 'Rating page concurrency');
	if (size === 0 || concurrency === 0) throw new Error('Rating pagination must be positive');

	const entries = [];
	for (let batchOffset = 0; batchOffset < total; batchOffset += size * concurrency) {
		const requests = [];
		for (let index = 0; index < concurrency; index += 1) {
			const offset = batchOffset + (index * size);
			if (offset >= total) break;
			requests.push({
				offset,
				expected: Math.min(size, total - offset),
				promise: contract.getTopPlayers(offset, size)
			});
		}
		const pages = await Promise.all(requests.map(request => request.promise));
		for (let index = 0; index < pages.length; index += 1) {
			const addresses = pages[index].addresses || pages[index][0] || [];
			const ratings = pages[index].ratings || pages[index][1] || [];
			if (addresses.length !== requests[index].expected || ratings.length !== addresses.length) {
				throw new Error(`Incomplete rating page at offset ${requests[index].offset}`);
			}
			for (let entryIndex = 0; entryIndex < addresses.length; entryIndex += 1) {
				entries.push({
					address: addresses[entryIndex],
					rating: normalizeCount(ratings[entryIndex], 'Player rating')
				});
			}
		}
	}
	return entries;
}
