// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ChessMediaLibrary.sol";

/// @title ChessBoard - Base contract with board state and constants
/// @notice Contains the chessboard, piece constants, and initialization logic
contract ChessBoard {
    uint8 constant BOARD_SIZE = 8;

    using ChessMediaLibrary for int8[BOARD_SIZE][BOARD_SIZE];
    int8[BOARD_SIZE][BOARD_SIZE] public board;

    // Piece constants from ChessMediaLibrary
    int8 internal constant EMPTY = ChessMediaLibrary.EMPTY;
    int8 internal constant PAWN = ChessMediaLibrary.PAWN;
    int8 internal constant KNIGHT = ChessMediaLibrary.KNIGHT;
    int8 internal constant BISHOP = ChessMediaLibrary.BISHOP;
    int8 internal constant ROOK = ChessMediaLibrary.ROOK;
    int8 internal constant QUEEN = ChessMediaLibrary.QUEEN;
    int8 internal constant KING = ChessMediaLibrary.KING;

    // Row constants
    uint8 internal constant ROW_BLACK_PIECES = 0;
    uint8 internal constant ROW_BLACK_PAWNS = 1;
    uint8 internal constant ROW_BLACK_PAWNS_LONG_OPENING = 3;
    uint8 internal constant ROW_WHITE_PAWNS_LONG_OPENING = 4;
    uint8 internal constant ROW_WHITE_PAWNS = 6;
    uint8 internal constant ROW_WHITE_PIECES = 7;

    // Column constants
    uint8 internal constant COL_SHORTW_LONGB_ROOK = 0;
    uint8 internal constant COL_UNNAMED_KNIGHT = 1;
    uint8 internal constant COL_BISHOP = 2;
    uint8 internal constant COL_QUEEN = 3;
    uint8 internal constant COL_KING = 4;
    uint8 internal constant COL_UNNAMED_BISHOP = 5;
    uint8 internal constant COL_KNIGHT = 6;
    uint8 internal constant COL_LONGW_SHORTB_ROOK = 7;

    // Player constants
    int8 internal constant PLAYER_WHITE = 1;
    int8 internal constant PLAYER_BLACK = -1;

    // Castling tracking
    bool internal whiteKingMoved;
    bool internal whiteShortRookMoved;
    bool internal whiteLongRookMoved;
    bool internal blackKingMoved;
    bool internal blackLongRookMoved;
    bool internal blackShortRookMoved;

    // En passant tracking
    int8 internal enPassantCol = -1;
    uint8 internal enPassantRow;

    // King position caching (avoids O(n²) search)
    uint8 internal whiteKingRow;
    uint8 internal whiteKingCol;
    uint8 internal blackKingRow;
    uint8 internal blackKingCol;

    // Threefold repetition tracking
    mapping(bytes32 => uint8) internal positionCount;
    bytes32[] internal positionHistory;
    uint8 internal maxPositionRepetitions; // Cached max repetitions (avoids O(n) loop)

    // 50-move rule tracking (half-moves since last pawn move or capture)
    uint16 internal halfMoveClock;

    /// @notice Initialize the board with starting positions
    function initializeBoard() internal {
        // Set up black pieces (row 0)
        board[ROW_BLACK_PIECES][COL_SHORTW_LONGB_ROOK] = -ROOK;
        board[ROW_BLACK_PIECES][COL_UNNAMED_KNIGHT] = -KNIGHT;
        board[ROW_BLACK_PIECES][COL_BISHOP] = -BISHOP;
        board[ROW_BLACK_PIECES][COL_QUEEN] = -QUEEN;
        board[ROW_BLACK_PIECES][COL_KING] = -KING;
        board[ROW_BLACK_PIECES][COL_UNNAMED_BISHOP] = -BISHOP;
        board[ROW_BLACK_PIECES][COL_KNIGHT] = -KNIGHT;
        board[ROW_BLACK_PIECES][COL_LONGW_SHORTB_ROOK] = -ROOK;

        for (uint8 col = 0; col < BOARD_SIZE; col++) {
            board[ROW_BLACK_PAWNS][col] = -PAWN;
        }

        // Set up white pieces (row 7)
        board[ROW_WHITE_PIECES][COL_SHORTW_LONGB_ROOK] = ROOK;
        board[ROW_WHITE_PIECES][COL_UNNAMED_KNIGHT] = KNIGHT;
        board[ROW_WHITE_PIECES][COL_BISHOP] = BISHOP;
        board[ROW_WHITE_PIECES][COL_QUEEN] = QUEEN;
        board[ROW_WHITE_PIECES][COL_KING] = KING;
        board[ROW_WHITE_PIECES][COL_UNNAMED_BISHOP] = BISHOP;
        board[ROW_WHITE_PIECES][COL_KNIGHT] = KNIGHT;
        board[ROW_WHITE_PIECES][COL_LONGW_SHORTB_ROOK] = ROOK;

        for (uint8 col = 0; col < BOARD_SIZE; col++) {
            board[ROW_WHITE_PAWNS][col] = PAWN;
        }

        // Reset castling flags
        whiteKingMoved = false;
        whiteShortRookMoved = false;
        whiteLongRookMoved = false;
        blackKingMoved = false;
        blackLongRookMoved = false;
        blackShortRookMoved = false;

        // Initialize king positions
        whiteKingRow = ROW_WHITE_PIECES;
        whiteKingCol = COL_KING;
        blackKingRow = ROW_BLACK_PIECES;
        blackKingCol = COL_KING;
    }

    /// @notice Absolute value of int8
    function abs(int8 x) internal pure returns (uint8) {
        return x >= 0 ? uint8(x) : uint8(-x);
    }

    /// @notice Print board as string (deprecated - use getBoardState)
    function printBoard() public pure returns (string memory) {
        return "";
    }

    /// @notice Get SVG representation of the board
    function printChessBoardLayoutSVG() external view returns (string memory) {
        return board.getCurrentBoard();
    }

    /// @notice Get entire board state in a single call (saves 63 RPC calls)
    /// @return The complete 8x8 board array
    function getBoardState() external view returns (int8[8][8] memory) {
        return board;
    }

    /// @notice Compute a hash of the current position for repetition detection
    /// @dev Includes board state, castling rights, en passant, and turn
    function _computePositionHash(bool isWhiteTurn) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            board,
            isWhiteTurn,
            whiteKingMoved,
            whiteShortRookMoved,
            whiteLongRookMoved,
            blackKingMoved,
            blackShortRookMoved,
            blackLongRookMoved,
            enPassantCol
        ));
    }

    /// @notice Get draw rule status
    /// @return halfMoves Current half-move clock (50-move rule)
    /// @return maxRepetitions Maximum times any position has occurred
    function getDrawRuleStatus() external view returns (uint16 halfMoves, uint8 maxRepetitions) {
        halfMoves = halfMoveClock;
        maxRepetitions = maxPositionRepetitions;
    }
}
