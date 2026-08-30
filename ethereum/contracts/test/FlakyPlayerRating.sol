// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only rating target that can simulate a temporary downstream outage.
contract FlakyPlayerRating {
    bool public shouldFail = true;
    uint256 public successfulReports;
    mapping(address => bool) public validGameContracts;

    function setShouldFail(bool value) external {
        shouldFail = value;
    }

    function registerGameContract(address gameContract) external {
        validGameContracts[gameContract] = true;
    }

    function reportGame(address, address, uint8) external {
        require(validGameContracts[msg.sender], "Not authorized");
        require(!shouldFail, "Temporary rating failure");
        successfulReports++;
    }
}
