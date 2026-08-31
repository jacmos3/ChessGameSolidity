// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only reward target that can simulate a temporary downstream outage.
contract FlakyRewardPool {
    bool public shouldFail = true;
    uint256 public successfulDistributions;
    mapping(address => bool) public validGameContracts;

    function setShouldFail(bool value) external {
        shouldFail = value;
    }

    function registerGameContract(address gameContract) external {
        validGameContracts[gameContract] = true;
    }

    function distributeGameRewards(
        address,
        address,
        uint8,
        bool,
        uint256,
        bool,
        bool,
        bool,
        bool,
        address
    ) external {
        require(validGameContracts[msg.sender], "Not authorized");
        require(!shouldFail, "Temporary reward failure");
        successfulDistributions++;
    }
}
