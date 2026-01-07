// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title ChessTimelock
 * @notice Timelock controller for Chess protocol governance
 * @dev Adds a mandatory delay before any governance action is executed
 *
 * Key Features:
 * - Minimum delay before execution (prevents flash loan attacks)
 * - Proposers can queue transactions
 * - Executors can execute after delay
 * - Admin can cancel pending transactions
 *
 * Default Configuration:
 * - Min Delay: 2 days (48 hours)
 * - Proposers: ChessGovernor contract
 * - Executors: Anyone (after delay passed)
 */
contract ChessTimelock is TimelockController {
    /**
     * @notice Initialize the timelock controller
     * @param minDelay Minimum delay in seconds before execution
     * @param proposers Addresses that can propose (typically the Governor)
     * @param executors Addresses that can execute (address(0) = anyone)
     * @param admin Admin address (can grant/revoke roles)
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
