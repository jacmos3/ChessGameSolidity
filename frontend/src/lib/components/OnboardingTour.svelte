<script>
	import { onboarding, ONBOARDING_STEPS } from '$lib/stores/onboarding.js';

	$: currentStepData = ONBOARDING_STEPS[$onboarding.currentStep];
	$: isFirst = $onboarding.currentStep === 0;
	$: isLast = $onboarding.currentStep === ONBOARDING_STEPS.length - 1;
	$: progress = (($onboarding.currentStep + 1) / ONBOARDING_STEPS.length) * 100;
</script>

{#if $onboarding.isActive}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
		on:click={onboarding.skip}
	></div>

	<!-- Modal -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
		<div class="bg-chess-dark border border-chess-accent/30 rounded-xl shadow-2xl max-w-md w-full pointer-events-auto">
			<!-- Progress bar -->
			<div class="h-1 bg-chess-darker rounded-t-xl overflow-hidden">
				<div
					class="h-full bg-chess-accent transition-all duration-300"
					style="width: {progress}%"
				></div>
			</div>

			<!-- Content -->
			<div class="p-6">
				<!-- Step indicator -->
				<div class="flex items-center justify-between mb-4">
					<span class="text-chess-accent text-sm font-medium">
						Step {$onboarding.currentStep + 1} of {ONBOARDING_STEPS.length}
					</span>
					<button
						class="text-chess-gray hover:text-white text-sm"
						on:click={onboarding.skip}
					>
						Skip tour
					</button>
				</div>

				<!-- Step content -->
				<h3 class="font-display text-xl mb-3">{currentStepData.title}</h3>
				<p class="text-chess-gray mb-6">{currentStepData.content}</p>

				<!-- Navigation -->
				<div class="flex justify-between gap-3">
					{#if !isFirst}
						<button
							class="btn btn-secondary flex-1"
							on:click={onboarding.prev}
						>
							Back
						</button>
					{:else}
						<div class="flex-1"></div>
					{/if}

					{#if isLast}
						<button
							class="btn btn-primary flex-1"
							on:click={onboarding.complete}
						>
							Get Started
						</button>
					{:else}
						<button
							class="btn btn-primary flex-1"
							on:click={onboarding.next}
						>
							Next
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
