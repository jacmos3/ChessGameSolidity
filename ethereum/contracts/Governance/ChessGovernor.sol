// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/**
 * @title ChessGovernor
 * @notice Governance contract for the Chess protocol
 * @dev Implements OpenZeppelin Governor with multiple extensions
 *
 * Voting Parameters:
 * - Voting Delay: 1 day (time before voting starts after proposal)
 * - Voting Period: 5 days
 * - Proposal Threshold: 100,000 CHESS (0.1% of supply to propose)
 * - Quorum: 4% of total supply must vote
 *
 * Key Features:
 * - Token-based voting with delegation (ERC20Votes)
 * - Timelock integration for execution delay
 * - Quorum requirements to prevent low-participation attacks
 * - Simple majority voting (For/Against/Abstain)
 *
 * Governable Parameters:
 * - BondingManager: bondRatioChess, bondRatioEth, minBondEthValue
 * - DisputeDAO: challengeWindow, commitPeriod, revealPeriod, quorum, supermajority
 * - ArbitratorRegistry: tier thresholds, cooldown periods
 * - ChessFactory: platform fee percentage
 */
contract ChessGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /**
     * @notice Initialize the governor
     * @param _token The CHESS token with voting power
     * @param _timelock The timelock controller for execution
     */
    constructor(
        IVotes _token,
        TimelockController _timelock
    )
        Governor("Chess Governor")
        GovernorSettings(
            7200,       // 1 day voting delay (7200 blocks @ 12s/block)
            36000,      // 5 days voting period (36000 blocks @ 12s/block)
            100000e18   // 100,000 CHESS proposal threshold
        )
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4) // 4% quorum
        GovernorTimelockControl(_timelock)
    {}

    // Required overrides

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }
}
