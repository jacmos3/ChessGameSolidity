// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ChessRulesEngine {
    error InvalidBoardPiece(int8 piece, uint8 row, uint8 col);

    uint8 internal constant BOARD_SIZE = 8;

    int8 internal constant EMPTY = 0;
    int8 internal constant PAWN = 1;
    int8 internal constant KNIGHT = 2;
    int8 internal constant BISHOP = 3;
    int8 internal constant ROOK = 4;
    int8 internal constant QUEEN = 5;
    int8 internal constant KING = 6;

    uint8 internal constant ROW_BLACK_PIECES = 0;
    uint8 internal constant ROW_BLACK_PAWNS = 1;
    uint8 internal constant ROW_BLACK_PAWNS_LONG_OPENING = 3;
    uint8 internal constant ROW_WHITE_PAWNS_LONG_OPENING = 4;
    uint8 internal constant ROW_WHITE_PAWNS = 6;
    uint8 internal constant ROW_WHITE_PIECES = 7;

    uint8 internal constant COL_SHORTW_LONGB_ROOK = 0;
    uint8 internal constant COL_UNNAMED_KNIGHT = 1;
    uint8 internal constant COL_BISHOP = 2;
    uint8 internal constant COL_QUEEN = 3;
    uint8 internal constant COL_KING = 4;
    uint8 internal constant COL_UNNAMED_BISHOP = 5;
    uint8 internal constant COL_KNIGHT = 6;
    uint8 internal constant COL_LONGW_SHORTB_ROOK = 7;

    int8 internal constant PLAYER_WHITE = 1;
    int8 internal constant PLAYER_BLACK = -1;

    uint8 internal constant STATE_IN_PROGRESS = 1;
    uint8 internal constant STATE_DRAW = 2;
    uint8 internal constant STATE_WHITE_WINS = 3;
    uint8 internal constant STATE_BLACK_WINS = 4;

    uint8 internal constant FLAG_WHITE_KING_MOVED = 1 << 0;
    uint8 internal constant FLAG_WHITE_SHORT_ROOK_MOVED = 1 << 1;
    uint8 internal constant FLAG_WHITE_LONG_ROOK_MOVED = 1 << 2;
    uint8 internal constant FLAG_BLACK_KING_MOVED = 1 << 3;
    uint8 internal constant FLAG_BLACK_LONG_ROOK_MOVED = 1 << 4;
    uint8 internal constant FLAG_BLACK_SHORT_ROOK_MOVED = 1 << 5;

    function isValidMoveView(
        int8[8][8] memory board,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 castlingFlags,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) external pure returns (bool) {
        if (!_areBoardCoordinates(startX, startY) || !_areBoardCoordinates(endX, endY)) {
            return false;
        }
        return _isValidMoveView(board, enPassantCol, enPassantRow, castlingFlags, startX, startY, endX, endY);
    }

    function wouldMoveLeaveKingInCheck(
        int8[8][8] memory board,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) external pure returns (bool) {
        if (
            !_areBoardCoordinates(whiteKingRow, whiteKingCol) ||
            !_areBoardCoordinates(blackKingRow, blackKingCol) ||
            !_areBoardCoordinates(startX, startY) ||
            !_areBoardCoordinates(endX, endY)
        ) {
            return true;
        }
        return _wouldMoveLeaveKingInCheck(board, whiteKingRow, whiteKingCol, blackKingRow, blackKingCol, startX, startY, endX, endY);
    }

    /// @notice Return an en-passant marker only when it enables a legal capture.
    /// @dev A pinned adjacent pawn is not enough: at least one capture must leave
    ///      the moving side's king safe for the positions to be distinct.
    function canonicalEnPassantForPosition(
        int8[8][8] memory board,
        bool isWhiteTurn,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        int8 enPassantCol,
        uint8 enPassantRow
    ) external pure returns (int8 canonicalCol, uint8 canonicalRow) {
        if (
            !_areBoardCoordinates(whiteKingRow, whiteKingCol) ||
            !_areBoardCoordinates(blackKingRow, blackKingCol) ||
            enPassantCol < 0 ||
            enPassantCol >= int8(BOARD_SIZE)
        ) {
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

        if (
            col > 0 &&
            board[pawnRow][col - 1] == capturingPawn &&
            _isValidMoveView(
                board,
                enPassantCol,
                enPassantRow,
                0,
                pawnRow,
                col - 1,
                targetRow,
                col
            ) &&
            !_wouldMoveLeaveKingInCheck(
                board,
                whiteKingRow,
                whiteKingCol,
                blackKingRow,
                blackKingCol,
                pawnRow,
                col - 1,
                targetRow,
                col
            )
        ) {
            return (enPassantCol, enPassantRow);
        }

        if (
            col < BOARD_SIZE - 1 &&
            board[pawnRow][col + 1] == capturingPawn &&
            _isValidMoveView(
                board,
                enPassantCol,
                enPassantRow,
                0,
                pawnRow,
                col + 1,
                targetRow,
                col
            ) &&
            !_wouldMoveLeaveKingInCheck(
                board,
                whiteKingRow,
                whiteKingCol,
                blackKingRow,
                blackKingCol,
                pawnRow,
                col + 1,
                targetRow,
                col
            )
        ) {
            return (enPassantCol, enPassantRow);
        }

        return (-1, 0);
    }

    function _wouldMoveLeaveKingInCheck(
        int8[8][8] memory board,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        int8 piece = board[startX][startY];
        if (!_isSupportedNonEmptyPiece(piece)) {
            return true;
        }
        int8 player = (piece > 0) ? PLAYER_WHITE : PLAYER_BLACK;
        uint8 kingX = (_abs(piece) == uint8(KING)) ? endX : (player == PLAYER_WHITE ? whiteKingRow : blackKingRow);
        uint8 kingY = (_abs(piece) == uint8(KING)) ? endY : (player == PLAYER_WHITE ? whiteKingCol : blackKingCol);
        uint8 clearedRow = BOARD_SIZE;
        uint8 clearedCol = BOARD_SIZE;

        // En passant removes a pawn from a square other than the move destination.
        if (_abs(piece) == uint8(PAWN) && startY != endY && board[endX][endY] == EMPTY) {
            clearedRow = startX;
            clearedCol = endY;
        }

        for (uint8 row = 0; row < BOARD_SIZE; row++) {
            for (uint8 col = 0; col < BOARD_SIZE; col++) {
                if (
                    (row == endX && col == endY) ||
                    (row == clearedRow && col == clearedCol)
                ) {
                    continue;
                }

                int8 boardPiece = board[row][col];
                if (boardPiece == EMPTY) {
                    continue;
                }

                if (!_isSupportedNonEmptyPiece(boardPiece)) {
                    return true;
                }

                if (_isSameColor(boardPiece, player)) {
                    continue;
                }

                if (_canAttack(
                    board,
                    row,
                    col,
                    boardPiece,
                    kingX,
                    kingY,
                    startX,
                    startY,
                    endX,
                    endY,
                    clearedRow,
                    clearedCol
                )) {
                    return true;
                }
            }
        }

        return false;
    }

    function detectCheckState(
        int8[8][8] memory board,
        bool moverIsWhite,
        bool tournamentMode,
        bool leavesKingInCheck,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 castlingFlags,
        uint8,
        uint8
    ) external pure returns (bool isCheck, bool isMate, uint8 newState) {
        _validateBoardPieces(board);

        if (tournamentMode && leavesKingInCheck) {
            // An illegal self-check move loses in Tournament mode, but it is not
            // checkmate and must not receive checkmate rewards or metadata.
            return (false, false, moverIsWhite ? STATE_BLACK_WINS : STATE_WHITE_WINS);
        }

        if (_isKingInCheck(board, PLAYER_BLACK, whiteKingRow, whiteKingCol, blackKingRow, blackKingCol, enPassantCol, enPassantRow, castlingFlags)) {
            isMate = _isCheckmate(
                board,
                PLAYER_BLACK,
                whiteKingRow,
                whiteKingCol,
                blackKingRow,
                blackKingCol,
                enPassantCol,
                enPassantRow,
                castlingFlags
            );
            return (!isMate, isMate, isMate ? STATE_WHITE_WINS : STATE_IN_PROGRESS);
        }

        if (_isKingInCheck(board, PLAYER_WHITE, whiteKingRow, whiteKingCol, blackKingRow, blackKingCol, enPassantCol, enPassantRow, castlingFlags)) {
            isMate = _isCheckmate(
                board,
                PLAYER_WHITE,
                whiteKingRow,
                whiteKingCol,
                blackKingRow,
                blackKingCol,
                enPassantCol,
                enPassantRow,
                castlingFlags
            );
            return (!isMate, isMate, isMate ? STATE_BLACK_WINS : STATE_IN_PROGRESS);
        }

        int8 nextPlayer = moverIsWhite ? PLAYER_BLACK : PLAYER_WHITE;
        return (
            false,
            false,
            _isStalemate(board, nextPlayer, whiteKingRow, whiteKingCol, blackKingRow, blackKingCol, enPassantCol, enPassantRow, castlingFlags)
                ? STATE_DRAW
                : STATE_IN_PROGRESS
        );
    }

    function _isKingInCheck(
        int8[8][8] memory board,
        int8 player,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 castlingFlags
    ) internal pure returns (bool) {
        uint8 kingX = (player == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingY = (player == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        for (uint8 row = 0; row < BOARD_SIZE; row++) {
            for (uint8 col = 0; col < BOARD_SIZE; col++) {
                int8 candidate = board[row][col];
                if (candidate != EMPTY && !_isSameColor(candidate, player)) {
                    if (_isValidMoveView(board, enPassantCol, enPassantRow, castlingFlags, row, col, kingX, kingY)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function _isValidMoveView(
        int8[8][8] memory board,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 castlingFlags,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        int8 piece = board[startX][startY];
        int8 target = board[endX][endY];

        if (!_isSupportedNonEmptyPiece(piece) || !_isSupportedPiece(target)) {
            return false;
        }

        if (_abs(int8(endY) - int8(startY)) == COL_BISHOP && _abs(piece) == uint8(KING)) {
            // Castling is a same-rank move to an empty square. Checking this
            // before the special branch prevents a king teleport/capture from
            // bypassing the ordinary same-color target guard below.
            if (startX != endX || target != EMPTY) {
                return false;
            }

            if (piece == KING) {
                if (startX == ROW_WHITE_PIECES && startY == COL_KING && !_hasFlag(castlingFlags, FLAG_WHITE_KING_MOVED)) {
                    if (_abs(board[startX][COL_LONGW_SHORTB_ROOK]) == uint8(ROOK) && endY == COL_KNIGHT && !_hasFlag(castlingFlags, FLAG_WHITE_LONG_ROOK_MOVED)) {
                        return board[startX][COL_LONGW_SHORTB_ROOK] == ROOK &&
                            _isCastlingPathSafe(board, piece, startX, startY, endY);
                    }
                    if (_abs(board[startX][COL_SHORTW_LONGB_ROOK]) == uint8(ROOK) && endY == COL_BISHOP && !_hasFlag(castlingFlags, FLAG_WHITE_SHORT_ROOK_MOVED)) {
                        return board[startX][COL_SHORTW_LONGB_ROOK] == ROOK &&
                            _isCastlingPathSafe(board, piece, startX, startY, endY);
                    }
                }
            } else {
                if (startX == ROW_BLACK_PIECES && startY == COL_KING && !_hasFlag(castlingFlags, FLAG_BLACK_KING_MOVED)) {
                    if (_abs(board[startX][COL_LONGW_SHORTB_ROOK]) == uint8(ROOK) && endY == COL_KNIGHT && !_hasFlag(castlingFlags, FLAG_BLACK_LONG_ROOK_MOVED)) {
                        return board[startX][COL_LONGW_SHORTB_ROOK] == -ROOK &&
                            _isCastlingPathSafe(board, piece, startX, startY, endY);
                    }
                    if (_abs(board[startX][COL_SHORTW_LONGB_ROOK]) == uint8(ROOK) && endY == COL_BISHOP && !_hasFlag(castlingFlags, FLAG_BLACK_SHORT_ROOK_MOVED)) {
                        return board[startX][COL_SHORTW_LONGB_ROOK] == -ROOK &&
                            _isCastlingPathSafe(board, piece, startX, startY, endY);
                    }
                }
            }
            return false;
        }

        if (target != EMPTY && _isSameColor(piece, target)) {
            return false;
        }

        uint8 absPiece = _abs(piece);
        if (absPiece == uint8(PAWN)) {
            return _isPawnMoveValid(board, enPassantCol, enPassantRow, startX, startY, endX, endY, piece, target);
        }
        if (absPiece == uint8(KNIGHT)) {
            return _isKnightMoveValid(piece, target, startX, startY, endX, endY);
        }
        if (absPiece == uint8(BISHOP)) {
            return _isBishopMoveValid(board, piece, target, startX, startY, endX, endY);
        }
        if (absPiece == uint8(ROOK)) {
            return _isRookMoveValid(board, piece, target, startX, startY, endX, endY);
        }
        if (absPiece == uint8(QUEEN)) {
            return _isQueenMoveValid(board, piece, target, startX, startY, endX, endY);
        }
        if (absPiece == uint8(KING)) {
            return _isKingMoveValid(piece, target, startX, startY, endX, endY);
        }

        return false;
    }

    function _isPawnMoveValid(
        int8[8][8] memory board,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY,
        int8 piece,
        int8 target
    ) internal pure returns (bool) {
        if (startY == endY && target == EMPTY) {
            if (piece == -PAWN) {
                if (startX < BOARD_SIZE - 1 && endX == startX + 1) {
                    return true;
                }
                if (
                    startX == ROW_BLACK_PAWNS &&
                    endX == ROW_BLACK_PAWNS_LONG_OPENING &&
                    board[startX + 1][startY] == EMPTY
                ) {
                    return true;
                }
            } else {
                if (startX > 0 && endX == startX - 1) {
                    return true;
                }
                if (
                    startX == ROW_WHITE_PAWNS &&
                    endX == ROW_WHITE_PAWNS_LONG_OPENING &&
                    board[startX - 1][startY] == EMPTY
                ) {
                    return true;
                }
            }
        }

        if (_abs(int8(endY) - int8(startY)) == 1) {
            if (piece == PAWN && startX > 0 && endX == startX - 1 && target < 0) {
                return true;
            }
            if (piece == -PAWN && startX < BOARD_SIZE - 1 && endX == startX + 1 && target > 0) {
                return true;
            }
        }

        if (enPassantCol >= 0 && _abs(int8(endY) - int8(startY)) == 1 && target == EMPTY) {
            if (
                piece == PAWN &&
                startX == ROW_BLACK_PAWNS_LONG_OPENING &&
                endX == startX - 1 &&
                int8(endY) == enPassantCol &&
                enPassantRow == startX
            ) {
                return true;
            }

            if (
                piece == -PAWN &&
                startX == ROW_WHITE_PAWNS_LONG_OPENING &&
                endX == startX + 1 &&
                int8(endY) == enPassantCol &&
                enPassantRow == startX
            ) {
                return true;
            }
        }

        return false;
    }

    function _isKnightMoveValid(
        int8 piece,
        int8 target,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        uint8 deltaX = _abs(int8(endX) - int8(startX));
        uint8 deltaY = _abs(int8(endY) - int8(startY));
        return ((deltaX == 1 && deltaY == 2) || (deltaX == 2 && deltaY == 1)) && !_isSameColor(piece, target);
    }

    function _isBishopMoveValid(
        int8[8][8] memory board,
        int8 piece,
        int8 target,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        uint8 deltaX = _abs(int8(endX) - int8(startX));
        uint8 deltaY = _abs(int8(endY) - int8(startY));
        return deltaX == deltaY && _isPathClear(board, startX, startY, endX, endY) && !_isSameColor(piece, target);
    }

    function _isRookMoveValid(
        int8[8][8] memory board,
        int8 piece,
        int8 target,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        return (startX == endX || startY == endY) && _isPathClear(board, startX, startY, endX, endY) && !_isSameColor(piece, target);
    }

    function _isQueenMoveValid(
        int8[8][8] memory board,
        int8 piece,
        int8 target,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        uint8 deltaX = _abs(int8(endX) - int8(startX));
        uint8 deltaY = _abs(int8(endY) - int8(startY));
        return (deltaX == deltaY || startX == endX || startY == endY) && _isPathClear(board, startX, startY, endX, endY) && !_isSameColor(piece, target);
    }

    function _isKingMoveValid(
        int8 piece,
        int8 target,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        uint8 deltaX = _abs(int8(endX) - int8(startX));
        uint8 deltaY = _abs(int8(endY) - int8(startY));
        return deltaX <= 1 && deltaY <= 1 && !_isSameColor(piece, target);
    }

    function _isCastlingPathClear(
        int8[8][8] memory board,
        uint8 row,
        uint8 kingCol,
        uint8 destCol
    ) internal pure returns (bool) {
        uint8 minCol = kingCol < destCol ? kingCol : destCol;
        uint8 maxCol = kingCol > destCol ? kingCol : destCol;

        for (uint8 col = minCol + 1; col < maxCol; col++) {
            if (board[row][col] != EMPTY) {
                return false;
            }
        }

        if (destCol == COL_BISHOP && board[row][COL_UNNAMED_KNIGHT] != EMPTY) {
            return false;
        }

        return board[row][destCol] == EMPTY;
    }

    function _isCastlingPathSafe(
        int8[8][8] memory board,
        int8 kingPiece,
        uint8 row,
        uint8 kingCol,
        uint8 destCol
    ) internal pure returns (bool) {
        if (!_isCastlingPathClear(board, row, kingCol, destCol)) {
            return false;
        }

        int8 player = kingPiece > 0 ? PLAYER_WHITE : PLAYER_BLACK;
        uint8 transitCol = destCol > kingCol ? kingCol + 1 : kingCol - 1;

        return
            !_isSquareUnderAttackAfterKingMove(board, player, row, kingCol, row, kingCol) &&
            !_isSquareUnderAttackAfterKingMove(board, player, row, transitCol, row, kingCol) &&
            !_isSquareUnderAttackAfterKingMove(board, player, row, destCol, row, kingCol);
    }

    function _isPathClear(
        int8[8][8] memory board,
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY
    ) internal pure returns (bool) {
        uint8 deltaX = endX > startX ? endX - startX : startX - endX;
        uint8 deltaY = endY > startY ? endY - startY : startY - endY;
        bool stepXPositive = endX > startX;
        bool stepYPositive = endY > startY;

        if (deltaX == deltaY) {
            for (uint8 i = 1; i < deltaX; i++) {
                uint8 checkX = stepXPositive ? startX + i : startX - i;
                uint8 checkY = stepYPositive ? startY + i : startY - i;
                if (board[checkX][checkY] != EMPTY) {
                    return false;
                }
            }
            return true;
        }

        if (startX == endX) {
            for (uint8 i = 1; i < deltaY; i++) {
                uint8 checkY = stepYPositive ? startY + i : startY - i;
                if (board[startX][checkY] != EMPTY) {
                    return false;
                }
            }
            return true;
        }

        if (startY == endY) {
            for (uint8 i = 1; i < deltaX; i++) {
                uint8 checkX = stepXPositive ? startX + i : startX - i;
                if (board[checkX][startY] != EMPTY) {
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    function _isCheckmate(
        int8[8][8] memory board,
        int8 player,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 castlingFlags
    ) internal pure returns (bool) {
        return !_hasAnyLegalMove(
            board,
            player,
            whiteKingRow,
            whiteKingCol,
            blackKingRow,
            blackKingCol,
            enPassantCol,
            enPassantRow,
            castlingFlags
        );
    }

    function _isSquareUnderAttackAfterKingMove(
        int8[8][8] memory board,
        int8 player,
        uint8 targetX,
        uint8 targetY,
        uint8 fromX,
        uint8 fromY
    ) internal pure returns (bool) {
        for (uint8 row = 0; row < BOARD_SIZE; row++) {
            for (uint8 col = 0; col < BOARD_SIZE; col++) {
                if ((row == fromX && col == fromY) || (row == targetX && col == targetY)) {
                    continue;
                }

                int8 piece = board[row][col];
                if (piece != EMPTY && !_isSameColor(piece, player) && _canPieceAttackSquare(board, row, col, targetX, targetY, fromX, fromY)) {
                    return true;
                }
            }
        }

        return false;
    }

    function _canPieceAttackSquare(
        int8[8][8] memory board,
        uint8 pieceRow,
        uint8 pieceCol,
        uint8 targetRow,
        uint8 targetCol,
        uint8 ignoreRow,
        uint8 ignoreCol
    ) internal pure returns (bool) {
        int8 piece = board[pieceRow][pieceCol];
        if (!_isSupportedNonEmptyPiece(piece)) {
            return false;
        }
        uint8 absPiece = _abs(piece);

        if (absPiece == uint8(PAWN)) {
            int8 direction = (piece > 0) ? int8(-1) : int8(1);
            return int8(targetRow) == int8(pieceRow) + direction && _abs(int8(targetCol) - int8(pieceCol)) == 1;
        }

        if (absPiece == uint8(KNIGHT)) {
            uint8 deltaX = _abs(int8(targetRow) - int8(pieceRow));
            uint8 deltaY = _abs(int8(targetCol) - int8(pieceCol));
            return (deltaX == 2 && deltaY == 1) || (deltaX == 1 && deltaY == 2);
        }

        if (absPiece == uint8(KING)) {
            return _abs(int8(targetRow) - int8(pieceRow)) <= 1 && _abs(int8(targetCol) - int8(pieceCol)) <= 1;
        }

        if (absPiece != uint8(BISHOP) && absPiece != uint8(ROOK) && absPiece != uint8(QUEEN)) {
            return false;
        }

        return _canSlidingPieceAttack(board, pieceRow, pieceCol, targetRow, targetCol, ignoreRow, ignoreCol, absPiece);
    }

    function _canSlidingPieceAttack(
        int8[8][8] memory board,
        uint8 pieceRow,
        uint8 pieceCol,
        uint8 targetRow,
        uint8 targetCol,
        uint8 ignoreRow,
        uint8 ignoreCol,
        uint8 absPiece
    ) internal pure returns (bool) {
        if (absPiece != uint8(BISHOP) && absPiece != uint8(ROOK) && absPiece != uint8(QUEEN)) {
            return false;
        }

        int8 deltaRow = int8(targetRow) - int8(pieceRow);
        int8 deltaCol = int8(targetCol) - int8(pieceCol);
        uint8 absDeltaRow = _abs(deltaRow);
        uint8 absDeltaCol = _abs(deltaCol);

        bool isDiagonal = absDeltaRow == absDeltaCol && absDeltaRow > 0;
        bool isStraight = (deltaRow == 0 || deltaCol == 0) && (absDeltaRow > 0 || absDeltaCol > 0);

        if (absPiece == uint8(BISHOP) && !isDiagonal) {
            return false;
        }
        if (absPiece == uint8(ROOK) && !isStraight) {
            return false;
        }
        if (absPiece == uint8(QUEEN) && !isDiagonal && !isStraight) {
            return false;
        }

        int8 stepRow = (deltaRow == 0) ? int8(0) : (deltaRow > 0 ? int8(1) : int8(-1));
        int8 stepCol = (deltaCol == 0) ? int8(0) : (deltaCol > 0 ? int8(1) : int8(-1));
        uint8 checkRow = uint8(int8(pieceRow) + stepRow);
        uint8 checkCol = uint8(int8(pieceCol) + stepCol);

        while (checkRow != targetRow || checkCol != targetCol) {
            if (!(checkRow == ignoreRow && checkCol == ignoreCol) && board[checkRow][checkCol] != EMPTY) {
                return false;
            }
            checkRow = uint8(int8(checkRow) + stepRow);
            checkCol = uint8(int8(checkCol) + stepCol);
        }

        return true;
    }

    function _isStalemate(
        int8[8][8] memory board,
        int8 player,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 castlingFlags
    ) internal pure returns (bool) {
        uint8 kingRow = (player == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingCol = (player == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        if (_isSquareUnderAttackAfterKingMove(board, player, kingRow, kingCol, kingRow, kingCol)) {
            return false;
        }

        return !_hasAnyLegalMove(
            board,
            player,
            whiteKingRow,
            whiteKingCol,
            blackKingRow,
            blackKingCol,
            enPassantCol,
            enPassantRow,
            castlingFlags
        );
    }

    function _hasAnyLegalMove(
        int8[8][8] memory board,
        int8 player,
        uint8 whiteKingRow,
        uint8 whiteKingCol,
        uint8 blackKingRow,
        uint8 blackKingCol,
        int8 enPassantCol,
        uint8 enPassantRow,
        uint8 castlingFlags
    ) internal pure returns (bool) {
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                if (board[rowPiece][colPiece] == EMPTY || !_isSameColor(board[rowPiece][colPiece], player)) {
                    continue;
                }

                for (uint8 rowTarget = 0; rowTarget < BOARD_SIZE; rowTarget++) {
                    for (uint8 colTarget = 0; colTarget < BOARD_SIZE; colTarget++) {
                        if (rowTarget == rowPiece && colTarget == colPiece) {
                            continue;
                        }
                        if (_isValidMoveView(board, enPassantCol, enPassantRow, castlingFlags, rowPiece, colPiece, rowTarget, colTarget)) {
                            if (
                                !_wouldMoveLeaveKingInCheck(
                                    board,
                                    whiteKingRow,
                                    whiteKingCol,
                                    blackKingRow,
                                    blackKingCol,
                                    rowPiece,
                                    colPiece,
                                    rowTarget,
                                    colTarget
                                )
                            ) {
                                return true;
                            }
                        }
                    }
                }
            }
        }

        return false;
    }

    function _canAttack(
        int8[8][8] memory board,
        uint8 attackerRow,
        uint8 attackerCol,
        int8 attackerPiece,
        uint8 kingRow,
        uint8 kingCol,
        uint8 fromRow,
        uint8 fromCol,
        uint8 toRow,
        uint8 toCol,
        uint8 clearedRow,
        uint8 clearedCol
    ) internal pure returns (bool) {
        if (!_isSupportedNonEmptyPiece(attackerPiece)) {
            return false;
        }
        uint8 absPiece = _abs(attackerPiece);
        if (absPiece == uint8(PAWN)) {
            int8 direction = (attackerPiece > 0) ? int8(-1) : int8(1);
            return int8(kingRow) == int8(attackerRow) + direction && _abs(int8(kingCol) - int8(attackerCol)) == 1;
        }

        if (absPiece == uint8(KNIGHT)) {
            uint8 deltaX = _abs(int8(kingRow) - int8(attackerRow));
            uint8 deltaY = _abs(int8(kingCol) - int8(attackerCol));
            return (deltaX == 2 && deltaY == 1) || (deltaX == 1 && deltaY == 2);
        }

        if (absPiece == uint8(KING)) {
            return _abs(int8(kingRow) - int8(attackerRow)) <= 1 && _abs(int8(kingCol) - int8(attackerCol)) <= 1;
        }

        if (absPiece != uint8(BISHOP) && absPiece != uint8(ROOK) && absPiece != uint8(QUEEN)) {
            return false;
        }

        int8 deltaRow = int8(kingRow) - int8(attackerRow);
        int8 deltaCol = int8(kingCol) - int8(attackerCol);
        uint8 absDeltaRow = _abs(deltaRow);
        uint8 absDeltaCol = _abs(deltaCol);
        bool isDiagonal = absDeltaRow == absDeltaCol && absDeltaRow > 0;
        bool isStraight = (deltaRow == 0 || deltaCol == 0) && (absDeltaRow > 0 || absDeltaCol > 0);

        if (absPiece == uint8(BISHOP) && !isDiagonal) {
            return false;
        }
        if (absPiece == uint8(ROOK) && !isStraight) {
            return false;
        }
        if (absPiece == uint8(QUEEN) && !isDiagonal && !isStraight) {
            return false;
        }

        int8 stepRow = (deltaRow == 0) ? int8(0) : (deltaRow > 0 ? int8(1) : int8(-1));
        int8 stepCol = (deltaCol == 0) ? int8(0) : (deltaCol > 0 ? int8(1) : int8(-1));
        uint8 checkRow = uint8(int8(attackerRow) + stepRow);
        uint8 checkCol = uint8(int8(attackerCol) + stepCol);

        while (checkRow != kingRow || checkCol != kingCol) {
            if (
                !(checkRow == fromRow && checkCol == fromCol) &&
                !(checkRow == clearedRow && checkCol == clearedCol)
            ) {
                if ((checkRow == toRow && checkCol == toCol) || board[checkRow][checkCol] != EMPTY) {
                    return false;
                }
            }
            checkRow = uint8(int8(checkRow) + stepRow);
            checkCol = uint8(int8(checkCol) + stepCol);
        }

        return true;
    }

    function _hasFlag(uint8 flags, uint8 flag) internal pure returns (bool) {
        return flags & flag != 0;
    }

    function _areBoardCoordinates(uint8 row, uint8 col) internal pure returns (bool) {
        return row < BOARD_SIZE && col < BOARD_SIZE;
    }

    function _validateBoardPieces(int8[8][8] memory board) internal pure {
        for (uint8 row = 0; row < BOARD_SIZE; row++) {
            for (uint8 col = 0; col < BOARD_SIZE; col++) {
                int8 piece = board[row][col];
                if (!_isSupportedPiece(piece)) {
                    revert InvalidBoardPiece(piece, row, col);
                }
            }
        }
    }

    function _isSupportedPiece(int8 piece) internal pure returns (bool) {
        return piece >= -KING && piece <= KING;
    }

    function _isSupportedNonEmptyPiece(int8 piece) internal pure returns (bool) {
        return piece != EMPTY && _isSupportedPiece(piece);
    }

    function _isSameColor(int8 first, int8 second) internal pure returns (bool) {
        return first != EMPTY && second != EMPTY && ((first > 0) == (second > 0));
    }

    function _abs(int8 value) internal pure returns (uint8) {
        // Widen first so int8.min (-128) cannot overflow while being negated.
        return value >= 0 ? uint8(value) : uint8(uint16(-int16(value)));
    }
}
