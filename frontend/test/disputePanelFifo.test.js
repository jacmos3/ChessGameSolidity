import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const storeSource = await readFile(
	new URL('../src/lib/stores/dispute.js', import.meta.url),
	'utf8'
);
const panelSource = await readFile(
	new URL('../src/lib/components/DisputePanel.svelte', import.meta.url),
	'utf8'
);

test('FIFO activation uses the same context-bound dispute write path as other panel actions', () => {
	assert.match(storeSource, /bundle\.dao\.panelSelectionSequence\(normalizedDisputeId\)/);
	assert.match(storeSource, /bundle\.dao\.nextSelectionSequence\(\)/);
	assert.match(
		storeSource,
		/activatePanelSelection\(disputeId, expectedContext\)[\s\S]*?executeDisputeWrite\([\s\S]*?'activatePanelSelection'[\s\S]*?expectedContext[\s\S]*?assertActiveLoadedContext\(expectedContext\)/
	);
});

test('Selecting UI activates only an unscheduled FIFO head and hides finalize/refresh until scheduled', () => {
	assert.match(panelSource, /\{#if !disputeData\.panelSelectionBlock\}[\s\S]*?\{#if disputeData\.panelSelectionIsHead\}[\s\S]*?on:click=\{handleActivatePanelSelection\}[\s\S]*?\{:else\}[\s\S]*?still queued/);
	assert.match(panelSource, /\{:else\}[\s\S]*?on:click=\{handleFinalizePanel\}[\s\S]*?on:click=\{handleRefreshPanelSelection\}[\s\S]*?\{\/if\}/);
	assert.match(panelSource, /panelSelectionTimedOut = Boolean\([\s\S]*?panelSelectionIsHead/);
});

test('DisputePanel with the FIFO branch compiles through the app Vite pipeline', async () => {
	const vite = await createServer({
		server: { middlewareMode: true },
		appType: 'custom',
		logLevel: 'silent'
	});
	try {
		const module = await vite.ssrLoadModule('/src/lib/components/DisputePanel.svelte');
		assert.ok(module.default);
	} finally {
		await vite.close();
	}
});
