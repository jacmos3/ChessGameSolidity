// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../DAO/ArbitratorRegistry.sol";

/**
 * @dev Test-only harness for invariants that cannot be reached through wall-clock
 *      time manipulation without weakening production cooldowns.
 */
contract ArbitratorRegistryHarness is ArbitratorRegistry {
    constructor(address chessTokenAddress) ArbitratorRegistry(chessTokenAddress) {}

    function fillTier1ToCountForTest(uint256 targetCount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(targetCount <= MAX_ARBITRATORS_PER_TIER_POOL, "Target exceeds pool cap");
        while (tier1Arbitrators.length < targetCount) {
            address synthetic = address(uint160(0x100000 + tier1Arbitrators.length));
            _seedEligibleSynthetic(synthetic, TIER1_MIN);
            tier1Index[synthetic] = tier1Arbitrators.length;
            tier1Arbitrators.push(synthetic);
        }
    }

    function setTier1StakeForTest(uint256 index, uint256 activeStake)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(index < tier1Arbitrators.length, "Tier-one index out of bounds");
        require(activeStake >= TIER1_MIN && activeStake < TIER1_MAX, "Invalid tier-one stake");
        Arbitrator storage arb = arbitrators[tier1Arbitrators[index]];
        arb.stakedAmount = activeStake;
        arb.activatedStake = activeStake;
    }

    function fillTier1ToCapForTest() external onlyRole(DEFAULT_ADMIN_ROLE) {
        while (tier1Arbitrators.length < MAX_ARBITRATORS_PER_TIER_POOL) {
            address synthetic = address(uint160(0x100000 + tier1Arbitrators.length));
            _seedEligibleSynthetic(synthetic, TIER1_MIN);
            tier1Index[synthetic] = tier1Arbitrators.length;
            tier1Arbitrators.push(synthetic);
        }
    }

    function fillTier2ToCapForTest() external onlyRole(DEFAULT_ADMIN_ROLE) {
        while (tier2Arbitrators.length < MAX_ARBITRATORS_PER_TIER_POOL) {
            address synthetic = address(uint160(0x200000 + tier2Arbitrators.length));
            _seedEligibleSynthetic(synthetic, TIER2_MIN);
            tier2Index[synthetic] = tier2Arbitrators.length;
            tier2Arbitrators.push(synthetic);
        }
    }

    function fillTier3ToCapForTest() external onlyRole(DEFAULT_ADMIN_ROLE) {
        while (tier3Arbitrators.length < MAX_ARBITRATORS_PER_TIER_POOL) {
            address synthetic = address(uint160(0x300000 + tier3Arbitrators.length));
            _seedEligibleSynthetic(synthetic, TIER3_MIN);
            tier3Index[synthetic] = tier3Arbitrators.length;
            tier3Arbitrators.push(synthetic);
        }
    }

    function accountSeededPopulationForTest() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 accountedStake;
        uint256 accountedArbitrators;

        for (uint256 i = 0; i < tier1Arbitrators.length; ++i) {
            accountedStake += arbitrators[tier1Arbitrators[i]].stakedAmount;
            ++accountedArbitrators;
        }
        for (uint256 i = 0; i < tier2Arbitrators.length; ++i) {
            accountedStake += arbitrators[tier2Arbitrators[i]].stakedAmount;
            ++accountedArbitrators;
        }
        for (uint256 i = 0; i < tier3Arbitrators.length; ++i) {
            accountedStake += arbitrators[tier3Arbitrators[i]].stakedAmount;
            ++accountedArbitrators;
        }

        totalStaked = accountedStake;
        totalArbitrators = accountedArbitrators;
    }

    function _seedEligibleSynthetic(address synthetic, uint256 activeStake) internal {
        // Aggregate accounting is deliberately opt-in through
        // accountSeededPopulationForTest(). Snapshot-only tests can prove that
        // admission derives from the scanned population, while escalation tests
        // can create a fully backed, internally coherent synthetic population.
        Arbitrator storage arb = arbitrators[synthetic];
        arb.stakedAmount = activeStake;
        arb.activatedStake = activeStake;
        arb.reputation = INITIAL_REPUTATION;
        arb.isActive = true;
    }

    function reserveAssignmentForTest(uint256 disputeId, address arbitrator)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(!disputeAssignments[disputeId][arbitrator], "Assignment already exists");
        disputeAssignments[disputeId][arbitrator] = true;
        _reserveAssignment(disputeId, arbitrator, block.timestamp);
    }
}
