// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../Chess/ChessCore.sol";

/// @dev Test-only fixture for reaching long-game and replacement-piece states cheaply.
contract ChessCoreSecurityHarness is ChessCore {
    function setHalfMoveClockForTest(uint16 value) external {
        halfMoveClock = value;
    }

    function setBoardSquareForTest(uint8 row, uint8 col, int8 piece) external {
        require(row < BOARD_SIZE && col < BOARD_SIZE, "coordinates");
        board[row][col] = piece;
    }

    function getCachedKingsForTest()
        external
        view
        returns (uint8, uint8, uint8, uint8)
    {
        return (whiteKingRow, whiteKingCol, blackKingRow, blackKingCol);
    }

    function getTerminalFlagsForTest()
        external
        view
        returns (bool checkmate, bool resignationLike, bool timeoutLoss)
    {
        return (wasCheckmate, wasResign, wasTimeout);
    }
}
