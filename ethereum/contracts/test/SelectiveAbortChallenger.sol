// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISelectiveAbortDisputeDAO {
    function challengeDeposit() external view returns (uint256);
    function challenge(uint256 gameId, address accusedPlayer) external;
    function gameToDispute(uint256 gameId) external view returns (uint256);
    function getSelectedArbitrators(uint256 disputeId) external view returns (address[] memory);
}

/**
 * @dev Reproduces the old same-transaction selective-abort pattern. With the
 *      hardened two-phase flow there is no panel to conditionally reject, so the
 *      challenge remains committed and funded.
 */
contract SelectiveAbortChallenger {
    uint256 public lastDisputeId;
    uint256 public observedPanelSize;

    function attemptSelectiveAbort(
        address daoAddress,
        address tokenAddress,
        uint256 gameId,
        address accusedPlayer,
        address requiredFirstArbitrator
    ) external {
        ISelectiveAbortDisputeDAO dao = ISelectiveAbortDisputeDAO(daoAddress);
        uint256 deposit = dao.challengeDeposit();
        require(IERC20(tokenAddress).approve(daoAddress, deposit), "Approve failed");

        dao.challenge(gameId, accusedPlayer);
        uint256 disputeId = dao.gameToDispute(gameId);
        address[] memory panel = dao.getSelectedArbitrators(disputeId);

        // This was the exploitable conditional revert. It is now unreachable in
        // the challenge transaction because selection uses a future block.
        if (panel.length > 0 && panel[0] != requiredFirstArbitrator) {
            revert("Unfavorable panel");
        }

        lastDisputeId = disputeId;
        observedPanelSize = panel.length;
    }
}
