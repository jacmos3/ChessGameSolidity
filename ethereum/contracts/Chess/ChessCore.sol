// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ChessBoard.sol";

/// @title ChessCore - Main chess game logic
/// @notice Inherits from ChessBoard and implements move validation and game state
contract ChessCore is ChessBoard, ReentrancyGuard {
    uint public betting;
    bool private prizeClaimed;

    event Debug(int8 player, uint8 startX, uint8 startY, uint8 endX, uint8 endY, string comment);
    event PrizeClaimed(address winner, uint256 amount);
    event PlayerResigned(address player, address winner);
    // Define the GameState enum
    enum GameState { NotStarted, InProgress, Draw, WhiteWins, BlackWins }
    // Add a gameState variable to the contract
    GameState private gameState = GameState.NotStarted;

    address whitePlayer;
    address blackPlayer;
    address public currentPlayer;

    constructor(address _whitePlayer, uint _value) payable {
        // Chiamare initializeBoard nel costruttore
        initializeBoard();
        whitePlayer = _whitePlayer;
        currentPlayer = _whitePlayer;
        betting = _value;
    }
    /*
    //for debugging
    constructor(){
        initializeBoard();
        whitePlayer = 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4;
        currentPlayer = 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4;
        blackPlayer = 0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2;
        betting = address(this).balance;
    }
    */
   
   receive() external payable {
        require(gameState == GameState.NotStarted, "Game has already started");
    }

    function switchTurn() internal {
        currentPlayer = (currentPlayer == whitePlayer) ? blackPlayer : whitePlayer;
    }

   function joinGameAsBlack() public payable {
        require(msg.sender != whitePlayer, "You are already the white player");
        require(msg.value == betting, "Please send the same amount as the white player");
        require(blackPlayer == address(0), "Black player slot is already taken");
        blackPlayer = msg.sender;
        gameState = GameState.InProgress;
    }

    function claimPrize() external nonReentrant {
        require(!prizeClaimed, "Prize has already been claimed");
        require(
            gameState == GameState.WhiteWins ||
            gameState == GameState.BlackWins ||
            gameState == GameState.Draw,
            "Game is not finished yet"
        );

        prizeClaimed = true;
        uint256 totalPrize = address(this).balance;

        if (gameState == GameState.WhiteWins) {
            require(msg.sender == whitePlayer, "Only the winner can claim the prize");
            (bool success, ) = payable(whitePlayer).call{value: totalPrize}("");
            require(success, "Transfer to white player failed");
            emit PrizeClaimed(whitePlayer, totalPrize);
        }
        else if (gameState == GameState.BlackWins) {
            require(msg.sender == blackPlayer, "Only the winner can claim the prize");
            (bool success, ) = payable(blackPlayer).call{value: totalPrize}("");
            require(success, "Transfer to black player failed");
            emit PrizeClaimed(blackPlayer, totalPrize);
        }
        else if (gameState == GameState.Draw) {
            // In case of draw, split the prize equally
            uint256 halfPrize = totalPrize / 2;
            uint256 remainingPrize = totalPrize - halfPrize; // Handles odd wei amounts

            (bool successWhite, ) = payable(whitePlayer).call{value: halfPrize}("");
            require(successWhite, "Transfer to white player failed");
            emit PrizeClaimed(whitePlayer, halfPrize);

            (bool successBlack, ) = payable(blackPlayer).call{value: remainingPrize}("");
            require(successBlack, "Transfer to black player failed");
            emit PrizeClaimed(blackPlayer, remainingPrize);
        }
    }

    function resign() external {
        require(
            msg.sender == whitePlayer || msg.sender == blackPlayer,
            "Only players can resign"
        );
        require(
            gameState == GameState.InProgress || gameState == GameState.NotStarted,
            "Game is already finished"
        );

        address winner;
        if (msg.sender == whitePlayer) {
            gameState = GameState.BlackWins;
            winner = blackPlayer;
        } else {
            gameState = GameState.WhiteWins;
            winner = whitePlayer;
        }

        emit PlayerResigned(msg.sender, winner);
    }

    function isPawnMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view returns (bool) {
        // Check if pawn is moving forward
        if (startY == endY && target == 0) {
            if (piece == -PAWN) { // black pawn
                if (endX == startX + 1 || (startX == ROW_BLACK_PAWNS && endX == ROW_BLACK_PAWNS_LONG_OPENING)) {
                    return true;
                }
            } 
            else { // white pawn
                if (endX == startX - 1 || (startX == ROW_WHITE_PAWNS && endX == COL_KING)) {
                    return true;
                }
            }
        }

        // Check if pawn is capturing diagonally
        if (abs(int8(endY) - int8(startY)) == 1) {
            if (piece == PAWN && endX == startX - 1 && target < 0) { // White pawn captures black piece (moving up)
                return true;
            }
            else
            if (piece == -PAWN && endX == startX + 1 && target > 0) { // Black pawn captures white piece (moving down)
                return true;
            }
        }

        // En passant capture
        if (enPassantCol >= 0 && abs(int8(endY) - int8(startY)) == 1 && target == EMPTY) {
            // White pawn captures en passant
            if (piece == PAWN &&
                endX == startX - 1 &&
                startX == ROW_BLACK_PAWNS_LONG_OPENING && // White pawn must be on row 3 (adjacent to black's double move)
                int8(endY) == enPassantCol &&
                enPassantRow == startX) {
                return true;
            }
            // Black pawn captures en passant
            else if (piece == -PAWN &&
                     endX == startX + 1 &&
                     startX == ROW_WHITE_PAWNS_LONG_OPENING && // Black pawn must be on row 4 (adjacent to white's double move)
                     int8(endY) == enPassantCol &&
                     enPassantRow == startX) {
                return true;
            }
        }

        return false;
    }

    function isKnightMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private pure returns (bool) {
        // Check if knight moves in L-shape
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if ((deltaX == 1 && deltaY == 2) || (deltaX == 2 && deltaY == 1)) {
            if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                return true;
            }
        }
        return false;
    }


    function isBishopMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view returns (bool) {
        // Check if bishop moves diagonally
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if (deltaX == deltaY) {
            if (isPathClear(startX, startY, endX, endY)) {
                if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                    return true;
                }
            }
        }

        return false;
    }


    function isRookMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view returns (bool) {
        // Check if rook moves horizontally or vertically
        if (startX == endX || startY == endY) {
            if (isPathClear(startX, startY, endX, endY)) {
                if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                    return true;
                }
            }
        }

        return false;
    }


    function isQueenMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view  returns (bool) {
        // Check if queen moves diagonally, horizontally, or vertically
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if (deltaX == deltaY || startX == endX || startY == endY) {
            if (isPathClear(startX, startY, endX, endY)) {
                if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                    return true;
                }
            }
        }

        return false;
    }


    function isKingMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private pure returns (bool) {
        // Check if king moves one square in any direction
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if (deltaX <= 1 && deltaY <= 1) {
            if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                return true;
            }
        }

        return false;
    }


    function isKingInCheck(int8 player) private view returns (bool) {
        // Use cached king position instead of O(n²) search
        uint8 kingX = (player == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingY = (player == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        // Check if any of the opponent's pieces can attack the king
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                if (player * board[rowPiece][colPiece] < 0) { // Check if piece belongs to opponent
                    if (isValidMoveView(rowPiece, colPiece, kingX, kingY)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function isSquareUnderAttack(int8 player, uint8 x, uint8 y) internal view returns (bool) {
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                //check if the opponent pieces can do a valid move to that square
                if (currentPlayer == whitePlayer && board[rowPiece][colPiece] * player < 0 && isValidMoveView(rowPiece, colPiece, x, y)
                || currentPlayer == blackPlayer && board[rowPiece][colPiece] * player > 0 && isValidMoveView(rowPiece,colPiece, x, y)) {
                    return true;
                }
            }
        }
        return false;
    }

    function minY(uint8 a, uint8 b) internal pure returns (uint8) {
        return a < b ? a : b;
    }

    function maxY(uint8 a, uint8 b) internal pure returns (uint8) {
        return a > b ? a : b;
    }

    function isCastlingValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 player) internal view returns (bool) {
        // Verifica se il re attraversa caselle minacciate
        //TODO fai double check per capire se questo if è superfluo, visto che viene controllato dentro il for
        if (isSquareUnderAttack(player, startX, startY) || isSquareUnderAttack(player, endX, endY)) {
            return false;
        }

        // Verifica se le caselle attraversate sono libere
        if (startY == COL_KING && (endY == COL_BISHOP || endY == COL_KNIGHT)) {
            uint8 rookY = (endY == COL_KNIGHT) ? COL_SHORTW_LONGB_ROOK : COL_LONGW_SHORTB_ROOK;
            for (uint8 col = minY(startY, endY); col <= maxY(startY, endY); col++) {
                if (board[startX][col] != EMPTY || isSquareUnderAttack(player, startX, col) || isSquareUnderAttack(player, rookY, col)) {
                    return false;
                }
            }
        }

        return true;
    }

    /// @notice Check if the path is clear for castling (squares between king and destination must be empty)
    function isCastlingPathClear(uint8 row, uint8 kingCol, uint8 destCol) private view returns (bool) {
        // Determine direction
        uint8 minCol = kingCol < destCol ? kingCol : destCol;
        uint8 maxCol = kingCol > destCol ? kingCol : destCol;

        // Check all squares between king and destination (exclusive of king's start)
        for (uint8 col = minCol + 1; col < maxCol; col++) {
            if (board[row][col] != EMPTY) {
                return false;
            }
        }

        // For queenside castling, also check the b-file square (col 1) which rook passes through
        if (destCol == COL_BISHOP) { // Queenside
            if (board[row][COL_UNNAMED_KNIGHT] != EMPTY) { // b-file
                return false;
            }
        }

        // Check destination square is empty
        if (board[row][destCol] != EMPTY) {
            return false;
        }

        return true;
    }

    /// @notice Pure view validation - does NOT modify any state (used for check detection)
    function isValidMoveView(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private view returns (bool) {
        int8 piece = board[startX][startY];
        int8 target = board[endX][endY];

        // Check if the move is a castling attempt (king moves 2 squares)
        if (abs(int8(endY) - int8(startY)) == COL_BISHOP && abs(piece) == uint8(KING)) {
            if (piece == KING) { // White king
                if (startX == ROW_WHITE_PIECES && startY == COL_KING && !whiteKingMoved) {
                    // Kingside castling: king e1->g1 (col 4->6), rook h1 (col 7)
                    if (uint8(ROOK) == abs(board[startX][COL_LONGW_SHORTB_ROOK]) && endY == COL_KNIGHT && !whiteLongRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                    // Queenside castling: king e1->c1 (col 4->2), rook a1 (col 0)
                    if (uint8(ROOK) == abs(board[startX][COL_SHORTW_LONGB_ROOK]) && endY == COL_BISHOP && !whiteShortRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                }
            } else { // Black king
                if (startX == ROW_BLACK_PIECES && startY == COL_KING && !blackKingMoved) {
                    // Kingside castling: king e8->g8 (col 4->6), rook h8 (col 7)
                    if (uint8(ROOK) == abs(board[startX][COL_LONGW_SHORTB_ROOK]) && endY == COL_KNIGHT && !blackLongRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                    // Queenside castling: king e8->c8 (col 4->2), rook a8 (col 0)
                    if (uint8(ROOK) == abs(board[startX][COL_SHORTW_LONGB_ROOK]) && endY == COL_BISHOP && !blackShortRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                }
            }
            return false;
        }

        // Check if target square is empty or contains an opponent's piece
        if (target == EMPTY || piece * target < 0) {
            if (abs(piece) == uint8(PAWN)) {
                return isPawnMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(KNIGHT)) {
                return isKnightMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(BISHOP)) {
                return isBishopMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(ROOK)) {
                return isRookMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(QUEEN)) {
                return isQueenMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(KING)) {
                return isKingMoveValid(startX, startY, endX, endY, piece, target);
            }
        }

        return false;
    }

    /// @notice Validates move and updates rook moved flags when rook moves
    function isValidMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private returns (bool) {
        // First check if the move is valid using view function
        if (!isValidMoveView(startX, startY, endX, endY)) {
            return false;
        }

        int8 piece = board[startX][startY];

        // Update rook moved flags only when a rook actually moves
        if (abs(piece) == uint8(ROOK)) {
            if (startX == ROW_WHITE_PIECES && startY == COL_SHORTW_LONGB_ROOK && !whiteShortRookMoved) {
                whiteShortRookMoved = true;
            }
            else if (startX == ROW_WHITE_PIECES && startY == COL_LONGW_SHORTB_ROOK && !whiteLongRookMoved) {
                whiteLongRookMoved = true;
            }
            else if (startX == ROW_BLACK_PIECES && startY == COL_LONGW_SHORTB_ROOK && !blackLongRookMoved) {
                blackLongRookMoved = true;
            }
            else if (startX == ROW_BLACK_PIECES && startY == COL_SHORTW_LONGB_ROOK && !blackShortRookMoved) {
                blackShortRookMoved = true;
            }
        }

        return true;
    }

    function isPathClear(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private view returns (bool) {
        uint8 deltaX = endX > startX ? endX - startX : startX - endX;
        uint8 deltaY = endY > startY ? endY - startY : startY - endY;
        bool stepXPositive = endX > startX;
        bool stepYPositive = endY > startY;

        if (deltaX == deltaY) {
            // Diagonal move (bishop or queen)
            for (uint8 i = 1; i < deltaX; i++) {
                uint8 checkX = stepXPositive ? startX + i : startX - i;
                uint8 checkY = stepYPositive ? startY + i : startY - i;
                if (EMPTY != board[checkX][checkY]) {
                    return false;
                }
            }
        }
        else if (startX == endX) {
            // Horizontal move (same row, different column)
            for (uint8 i = 1; i < deltaY; i++) {
                uint8 checkY = stepYPositive ? startY + i : startY - i;
                if (EMPTY != board[startX][checkY]) {
                    return false;
                }
            }
        }
        else if (startY == endY) {
            // Vertical move (same column, different row)
            for (uint8 i = 1; i < deltaX; i++) {
                uint8 checkX = stepXPositive ? startX + i : startX - i;
                if (EMPTY != board[checkX][startY]) {
                    return false;
                }
            }
        }
        else {
            // Invalid move (not diagonal, horizontal, or vertical)
            return false;
        }

        return true;
    }

    modifier onlyCurrentPlayer() {
        require(msg.sender == currentPlayer, "It's not your turn!");
        _;
    }
    
    modifier onlyOwnPieces(uint8 startX, uint8 startY){
         //matching the current color player with the color number to check if it is moving it's own pieces
        int8 playerColor = 1;
        if (currentPlayer == blackPlayer){
            playerColor *= PLAYER_BLACK;
        }
        require(board[startX][startY] * playerColor > 0, "You can only move your own pieces");
        _;
    }

    // Wrapper for backward compatibility - promotes to Queen by default
    function makeMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) public {
        makeMoveWithPromotion(startX, startY, endX, endY, QUEEN);
    }

    // Main move function with promotion support
    function makeMoveWithPromotion(
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY,
        int8 promotionPiece
    ) public onlyCurrentPlayer onlyOwnPieces(startX, startY) {
        // Check if the game is in progress
        require(gameState == GameState.InProgress || gameState == GameState.NotStarted, "Game has not started or has ended");

        // Check if the move is valid
        require(isValidMove(startX, startY, endX, endY), "Invalid move");

        // Store the piece being moved before clearing the start position
        int8 movingPiece = board[startX][startY];
        int8 targetPiece = board[endX][endY];

        // Make the move
        board[endX][endY] = movingPiece;
        board[startX][startY] = EMPTY;

        // Update cached king position if king was moved
        if (abs(movingPiece) == uint8(KING)) {
            if (movingPiece == KING) {
                whiteKingRow = endX;
                whiteKingCol = endY;
            } else {
                blackKingRow = endX;
                blackKingCol = endY;
            }
        }

        // Track if this move sets up en passant for the opponent
        bool isDoublePawnMove = false;

        // Handle pawn-specific logic
        if (abs(movingPiece) == uint8(PAWN)) {
            // Check for en passant capture (diagonal move to empty square)
            if (abs(int8(endY) - int8(startY)) == 1 && targetPiece == EMPTY) {
                // This is an en passant capture - remove the captured pawn
                if (movingPiece == PAWN && enPassantCol == int8(endY) && startX == ROW_BLACK_PAWNS_LONG_OPENING) {
                    // White captures black pawn en passant (white is on row 3)
                    board[startX][endY] = EMPTY; // Remove the black pawn
                } else if (movingPiece == -PAWN && enPassantCol == int8(endY) && startX == ROW_WHITE_PAWNS_LONG_OPENING) {
                    // Black captures white pawn en passant (black is on row 4)
                    board[startX][endY] = EMPTY; // Remove the white pawn
                }
            }

            // Check for double pawn move (sets up en passant for opponent)
            if (movingPiece == PAWN && startX == ROW_WHITE_PAWNS && endX == ROW_WHITE_PAWNS_LONG_OPENING) {
                // White pawn double move
                isDoublePawnMove = true;
                enPassantCol = int8(endY);
                enPassantRow = endX; // Row 4
            } else if (movingPiece == -PAWN && startX == ROW_BLACK_PAWNS && endX == ROW_BLACK_PAWNS_LONG_OPENING) {
                // Black pawn double move
                isDoublePawnMove = true;
                enPassantCol = int8(endY);
                enPassantRow = endX; // Row 3
            }

            // Handle pawn promotion
            bool isWhitePawnPromoting = (movingPiece == PAWN && endX == ROW_BLACK_PIECES);
            bool isBlackPawnPromoting = (movingPiece == -PAWN && endX == ROW_WHITE_PIECES);

            if (isWhitePawnPromoting || isBlackPawnPromoting) {
                // Validate promotion piece (must be Queen, Rook, Bishop, or Knight)
                require(
                    promotionPiece == QUEEN ||
                    promotionPiece == ROOK ||
                    promotionPiece == BISHOP ||
                    promotionPiece == KNIGHT,
                    "Invalid promotion piece"
                );

                // Apply the correct sign based on player color
                if (isWhitePawnPromoting) {
                    board[endX][endY] = promotionPiece; // White piece (positive)
                } else {
                    board[endX][endY] = -promotionPiece; // Black piece (negative)
                }
            }
        }

        // Reset en passant if this was not a double pawn move
        if (!isDoublePawnMove) {
            enPassantCol = -1;
        }

        // Track king moves (any king move prevents future castling)
        if (uint8(KING) == abs(movingPiece)) {
            if (currentPlayer == whitePlayer) {
                whiteKingMoved = true;
            } else {
                blackKingMoved = true;
            }

            // Handle castling (king moves 2 squares horizontally)
            if (abs(int8(endY) - int8(startY)) == 2) {
                // Move the rook during castling
                if (endY == COL_KNIGHT) {
                    // Kingside castling - rook h1/h8 moves to f1/f8
                    board[startX][COL_UNNAMED_BISHOP] = board[startX][COL_LONGW_SHORTB_ROOK];
                    board[startX][COL_LONGW_SHORTB_ROOK] = EMPTY;
                } else if (endY == COL_BISHOP) {
                    // Queenside castling - rook a1/a8 moves to d1/d8
                    board[startX][COL_QUEEN] = board[startX][COL_SHORTW_LONGB_ROOK];
                    board[startX][COL_SHORTW_LONGB_ROOK] = EMPTY;
                }
            }
        }

        // Check if the move resulted in a check or checkmate
        if (isKingInCheck(PLAYER_BLACK)) {
            gameState = isCheckmate(PLAYER_BLACK, endX, endY) ? GameState.WhiteWins : GameState.InProgress;
        } else if (isKingInCheck(PLAYER_WHITE)) {
            gameState = isCheckmate(PLAYER_WHITE, endX, endY) ? GameState.BlackWins : GameState.InProgress;
        } else {
            gameState = isStalemate() ? GameState.Draw : GameState.InProgress;
        }

        switchTurn();
    }

    // Check if the given player's king can move out of check
    function canKingMove(int8 player) internal view returns (bool) {
        uint8 kingX = (player == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingY = (player == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        // Check all 8 adjacent squares
        for (int8 i = -1; i <= 1; i++) {
            for (int8 j = -1; j <= 1; j++) {
                if (i == 0 && j == 0) continue;
                if (isKingMoveEscape(player, kingX, kingY, i, j)) {
                    return true;
                }
            }
        }
        return false;
    }

    // Helper: Check if moving king by (di, dj) is a valid escape
    function isKingMoveEscape(int8 player, uint8 kingX, uint8 kingY, int8 di, int8 dj) internal view returns (bool) {
        int8 x = int8(kingX) + di;
        int8 y = int8(kingY) + dj;

        // Check bounds
        if (x < 0 || x >= int8(BOARD_SIZE) || y < 0 || y >= int8(BOARD_SIZE)) {
            return false;
        }

        uint8 newX = uint8(x);
        uint8 newY = uint8(y);
        int8 targetPiece = board[newX][newY];
        int8 kingPiece = board[kingX][kingY];

        // Can't capture own piece
        if (targetPiece != EMPTY && targetPiece * kingPiece > 0) {
            return false;
        }

        // Check if the destination square is safe (not under attack)
        return !isSquareUnderAttackAfterKingMove(player, newX, newY, kingX, kingY);
    }

    // Check if a square would be under attack after king moves there
    function isSquareUnderAttackAfterKingMove(int8 player, uint8 targetX, uint8 targetY, uint8 fromX, uint8 fromY) internal view returns (bool) {
        for (uint8 row = 0; row < BOARD_SIZE; row++) {
            for (uint8 col = 0; col < BOARD_SIZE; col++) {
                // Skip the square king is moving from and the target square
                if ((row == fromX && col == fromY) || (row == targetX && col == targetY)) continue;

                int8 piece = board[row][col];
                if (piece * player < 0) { // Opponent piece
                    if (canPieceAttackSquare(row, col, targetX, targetY, fromX, fromY)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Helper function to check if a piece can attack a square, considering that the king moved
    function canPieceAttackSquare(uint8 pieceRow, uint8 pieceCol, uint8 targetRow, uint8 targetCol, uint8 ignoreRow, uint8 ignoreCol) internal view returns (bool) {
        int8 piece = board[pieceRow][pieceCol];
        uint8 absPiece = abs(piece);

        if (absPiece == uint8(PAWN)) {
            int8 direction = (piece > 0) ? int8(-1) : int8(1);
            return (int8(targetRow) == int8(pieceRow) + direction && abs(int8(targetCol) - int8(pieceCol)) == 1);
        }
        if (absPiece == uint8(KNIGHT)) {
            uint8 dX = abs(int8(targetRow) - int8(pieceRow));
            uint8 dY = abs(int8(targetCol) - int8(pieceCol));
            return (dX == 2 && dY == 1) || (dX == 1 && dY == 2);
        }
        if (absPiece == uint8(KING)) {
            return abs(int8(targetRow) - int8(pieceRow)) <= 1 && abs(int8(targetCol) - int8(pieceCol)) <= 1;
        }

        // Sliding pieces (Bishop, Rook, Queen)
        return canSlidingPieceAttack(pieceRow, pieceCol, targetRow, targetCol, ignoreRow, ignoreCol, absPiece);
    }

    // Helper for sliding pieces attack check
    function canSlidingPieceAttack(uint8 pieceRow, uint8 pieceCol, uint8 targetRow, uint8 targetCol, uint8 ignoreRow, uint8 ignoreCol, uint8 absPiece) internal view returns (bool) {
        int8 deltaRow = int8(targetRow) - int8(pieceRow);
        int8 deltaCol = int8(targetCol) - int8(pieceCol);
        uint8 absDeltaRow = abs(deltaRow);
        uint8 absDeltaCol = abs(deltaCol);

        bool isDiagonal = (absDeltaRow == absDeltaCol && absDeltaRow > 0);
        bool isStraight = (deltaRow == 0 || deltaCol == 0) && (absDeltaRow > 0 || absDeltaCol > 0);

        if (absPiece == uint8(BISHOP) && !isDiagonal) return false;
        if (absPiece == uint8(ROOK) && !isStraight) return false;
        if (absPiece == uint8(QUEEN) && !isDiagonal && !isStraight) return false;

        // Check path is clear
        int8 stepRow = (deltaRow == 0) ? int8(0) : (deltaRow > 0 ? int8(1) : int8(-1));
        int8 stepCol = (deltaCol == 0) ? int8(0) : (deltaCol > 0 ? int8(1) : int8(-1));

        uint8 checkRow = uint8(int8(pieceRow) + stepRow);
        uint8 checkCol = uint8(int8(pieceCol) + stepCol);

        while (checkRow != targetRow || checkCol != targetCol) {
            if (!(checkRow == ignoreRow && checkCol == ignoreCol)) {
                if (board[checkRow][checkCol] != EMPTY) {
                    return false;
                }
            }
            checkRow = uint8(int8(checkRow) + stepRow);
            checkCol = uint8(int8(checkCol) + stepCol);
        }
        return true;
    }

    // Check if the game is in stalemate
    function isStalemate() internal view returns (bool) {
        int8 player = (currentPlayer == whitePlayer) ? int8(PLAYER_WHITE) : int8(PLAYER_BLACK);

        // Check if there are any valid moves for current player pieces
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                // If we find a piece belonging to the current player, then check if it can perform a move
                if (board[rowPiece][colPiece] * player > 0 ) {
                    for (uint8 row_target = 0; row_target < BOARD_SIZE; row_target++) {
                        for (uint8 col_target = 0; col_target < BOARD_SIZE; col_target++) {
                            if (board[row_target][col_target] != board[rowPiece][colPiece]
                                && isValidMoveView(rowPiece, colPiece, row_target, col_target)) {
                                return false;
                            }
                        }
                    }
                }
            }
        }

        // No any valid move for the current player
        return true;
    }

    // Check if the given player's king is in checkmate
    function isCheckmate(int8 player, uint8 attackerI, uint8 attackerJ) internal view returns (bool) {
        // Check if the king can move out of check
        if (canKingMove(player)) {
            return false;
        }

        // Check if the attacking piece can be captured
        if (canCaptureAttacker(player, attackerI, attackerJ)) {
            return false;
        }

        // Check if any other piece can block the attack
        if (canBlockAttack(attackerI, attackerJ)) {
            return false;
        }

        // The king is in checkmate
        return true;
    }

    // Check if the player pieces can capture the attacking piece
    function canCaptureAttacker(int8 player, uint8 rowAttacker, uint8 colAttacker) internal view returns (bool) {
        // Iterate over all pieces on the board
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                // Skip empty squares and pieces belonging to the attacker
                if (board[rowPiece][colPiece] == EMPTY || board[rowPiece][colPiece] * player < 0 || (rowPiece == rowAttacker && colPiece == colAttacker)) {
                    continue;
                }

                // Check if the piece can capture the attacking piece
                if (isValidMoveView(rowPiece, colPiece, rowAttacker, colAttacker)) {
                    // A piece can capture the attacking piece
                    return true;
                }
            }
        }

        // No piece can capture the attacking piece
        return false;
    }

    function canBlockAttack(uint8 rowAttacker, uint8 colAttacker) internal view returns (bool) {
        // Get the king position for the player in check
        // The player in check is the one whose turn it will be next (after the attacking move)
        int8 attackerPiece = board[rowAttacker][colAttacker];
        int8 defendingPlayer = (attackerPiece > 0) ? PLAYER_BLACK : PLAYER_WHITE;

        uint8 kingRow = (defendingPlayer == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingCol = (defendingPlayer == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        // Knights can't be blocked (they jump)
        if (abs(attackerPiece) == uint8(KNIGHT)) {
            return false;
        }

        // Find the squares between attacker and king that could be blocked
        int8 deltaRow = int8(kingRow) - int8(rowAttacker);
        int8 deltaCol = int8(kingCol) - int8(colAttacker);

        // Get step direction
        int8 stepRow = (deltaRow == 0) ? int8(0) : (deltaRow > 0 ? int8(1) : int8(-1));
        int8 stepCol = (deltaCol == 0) ? int8(0) : (deltaCol > 0 ? int8(1) : int8(-1));

        // Check each square between attacker and king
        uint8 blockRow = uint8(int8(rowAttacker) + stepRow);
        uint8 blockCol = uint8(int8(colAttacker) + stepCol);

        while (blockRow != kingRow || blockCol != kingCol) {
            // Check if any defending piece can move to this blocking square
            for (uint8 pieceRow = 0; pieceRow < BOARD_SIZE; pieceRow++) {
                for (uint8 pieceCol = 0; pieceCol < BOARD_SIZE; pieceCol++) {
                    int8 piece = board[pieceRow][pieceCol];

                    // Skip empty squares, opponent pieces, and the king (can't block with king)
                    if (piece == EMPTY || piece * defendingPlayer <= 0 || abs(piece) == uint8(KING)) {
                        continue;
                    }

                    // Check if this piece can move to the blocking square
                    if (isValidMoveView(pieceRow, pieceCol, blockRow, blockCol)) {
                        return true;
                    }
                }
            }

            blockRow = uint8(int8(blockRow) + stepRow);
            blockCol = uint8(int8(blockCol) + stepCol);
        }

        // No piece can block the attack
        return false;
    }

    function getPlayers() external view returns (address, address) {
        return (whitePlayer, blackPlayer);
    }

    /// @notice DEBUG ONLY - Place a piece on the board (remove before mainnet deployment)
    /// @dev This function is for testing purposes only
    function debugCreative(uint8 x, uint8 y, int8 piece) external returns (string memory) {
        board[x][y] = piece;
        // Update king position cache if placing a king
        if (piece == KING) {
            whiteKingRow = x;
            whiteKingCol = y;
        } else if (piece == -KING) {
            blackKingRow = x;
            blackKingCol = y;
        }
        return printBoard();
    }

    function getGameState () external view returns (uint8) {
        if (gameState == GameState.NotStarted) return 1;
        if (gameState == GameState.InProgress) return 2;
        if (gameState == GameState.Draw) return 3;
        if (gameState == GameState.WhiteWins) return 4;
        if (gameState == GameState.BlackWins) return 5;

        return 0;
    } 
}





