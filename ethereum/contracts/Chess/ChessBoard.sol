// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ChessMediaLibrary.sol";

/// @title ChessBoard - Base contract with board state and constants
/// @notice Contains the chessboard, piece constants, and initialization logic
contract ChessBoard {
    error InvalidBoardPiece(int8 piece, uint8 row, uint8 col);
    error InvalidKingCount(uint8 whiteKings, uint8 blackKings);

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

    // FIDE 75-move rule: automatic draw after 75 full moves (150 half-moves) without progress
    // This also caps game length to prevent unbounded positionHistory growth
    uint16 internal constant MAX_HALF_MOVES_WITHOUT_PROGRESS = 150;

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

        // Clone storage does not execute state-variable initializers from the
        // implementation constructor, so initialize sentinel values explicitly.
        enPassantCol = -1;
        enPassantRow = 0;
    }

    /// @notice Absolute value of int8
    function abs(int8 x) internal pure returns (uint8) {
        // Widen first so int8.min (-128) cannot overflow while being negated.
        return x >= 0 ? uint8(x) : uint8(uint16(-int16(x)));
    }

    /// @notice Return whether a value represents an empty square or a supported piece.
    function _isSupportedPiece(int8 piece) internal pure returns (bool) {
        return piece >= -KING && piece <= KING;
    }

    /// @notice Validate all pieces and derive the only authoritative king coordinates.
    /// @dev Setup finalization uses this scan instead of trusting incrementally-maintained caches.
    function _validateBoardAndLocateKings()
        internal
        view
        returns (uint8 whiteRow, uint8 whiteCol, uint8 blackRow, uint8 blackCol)
    {
        uint8 whiteKings;
        uint8 blackKings;

        for (uint8 row = 0; row < BOARD_SIZE; row++) {
            for (uint8 col = 0; col < BOARD_SIZE; col++) {
                int8 piece = board[row][col];
                if (!_isSupportedPiece(piece)) {
                    revert InvalidBoardPiece(piece, row, col);
                }

                if (piece == KING) {
                    whiteKings++;
                    whiteRow = row;
                    whiteCol = col;
                } else if (piece == -KING) {
                    blackKings++;
                    blackRow = row;
                    blackCol = col;
                }
            }
        }

        if (whiteKings != 1 || blackKings != 1) {
            revert InvalidKingCount(whiteKings, blackKings);
        }
    }

    /// @notice Replace all pre-game repetition bookkeeping with the finalized initial position.
    function _resetAndSeedPositionHistory(bool isWhiteTurn) internal {
        // positionHistory only contains unique keys, so clearing it also bounds this cleanup.
        for (uint256 i = 0; i < positionHistory.length; i++) {
            delete positionCount[positionHistory[i]];
        }
        delete positionHistory;

        bytes32 initialPosition = _computePositionHash(isWhiteTurn);
        positionCount[initialPosition] = 1;
        positionHistory.push(initialPosition);
        maxPositionRepetitions = 1;
    }

    /// @notice Print board as string (deprecated - use getBoardState)
    function printBoard() public pure returns (string memory) {
        return "";
    }

    function _renderBoardMetadata(uint256 tokenId) internal view returns (string memory) {
        return board.getCurrentBoard(tokenId);
    }

    /// @notice Get entire board state in a single call (saves 63 RPC calls)
    /// @return The complete 8x8 board array
    function getBoardState() external view returns (int8[8][8] memory) {
        return board;
    }

    /// @notice Compute a hash of the current position for repetition detection
    /// @dev Includes board state, castling rights, en passant, and turn
    function _computePositionHash(bool isWhiteTurn) internal view returns (bytes32) {
        (int8 canonicalEnPassantCol, uint8 canonicalEnPassantRow) =
            _canonicalEnPassantForPosition(isWhiteTurn);

        // Only the four still-available castling rights affect legal moves.
        // Once a king has moved, later changes to either rook's historical flag
        // must not split otherwise identical repetition positions.
        uint8 effectiveCastlingRights;
        if (!whiteKingMoved && !whiteShortRookMoved) effectiveCastlingRights |= 1 << 0;
        if (!whiteKingMoved && !whiteLongRookMoved) effectiveCastlingRights |= 1 << 1;
        if (!blackKingMoved && !blackShortRookMoved) effectiveCastlingRights |= 1 << 2;
        if (!blackKingMoved && !blackLongRookMoved) effectiveCastlingRights |= 1 << 3;

        return keccak256(abi.encodePacked(
            board,
            isWhiteTurn,
            effectiveCastlingRights,
            canonicalEnPassantCol,
            canonicalEnPassantRow
        ));
    }

    /// @notice Return the en-passant marker only when the side to move has a capturing pawn.
    /// @dev A double pawn move with no adjacent opposing pawn does not change the set of
    ///      available moves and therefore must not make an otherwise identical position unique.
    function _canonicalEnPassantForPosition(bool isWhiteTurn)
        internal
        view
        virtual
        returns (int8 canonicalCol, uint8 canonicalRow)
    {
        if (enPassantCol < 0 || enPassantCol >= int8(BOARD_SIZE)) {
            return (-1, 0);
        }

        uint8 col = uint8(enPassantCol);
        uint8 pawnRow = isWhiteTurn
            ? ROW_BLACK_PAWNS_LONG_OPENING
            : ROW_WHITE_PAWNS_LONG_OPENING;
        uint8 targetRow = isWhiteTurn ? pawnRow - 1 : pawnRow + 1;
        int8 movedPawn = isWhiteTurn ? -PAWN : PAWN;
        int8 capturingPawn = isWhiteTurn ? PAWN : -PAWN;

        if (
            enPassantRow != pawnRow ||
            board[pawnRow][col] != movedPawn ||
            board[targetRow][col] != EMPTY
        ) {
            return (-1, 0);
        }

        bool canCaptureFromLeft = col > 0 && board[pawnRow][col - 1] == capturingPawn;
        bool canCaptureFromRight = col < BOARD_SIZE - 1 && board[pawnRow][col + 1] == capturingPawn;
        if (!canCaptureFromLeft && !canCaptureFromRight) {
            return (-1, 0);
        }

        return (enPassantCol, enPassantRow);
    }

    /// @notice Get draw rule status
    /// @return halfMoves Current half-move clock (50-move rule)
    /// @return maxRepetitions Maximum times any position has occurred
    function getDrawRuleStatus() external view returns (uint16 halfMoves, uint8 maxRepetitions) {
        halfMoves = halfMoveClock;
        maxRepetitions = maxPositionRepetitions;
    }
}
