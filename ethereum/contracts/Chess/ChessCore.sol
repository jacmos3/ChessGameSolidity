// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "@openzeppelin/contracts/utils/Strings.sol";
import "./ChessMediaLibrary.sol";
contract ChessCore {
    uint8 constant BOARD_SIZE = 8;
    using ChessMediaLibrary for int8[BOARD_SIZE][BOARD_SIZE];
    int8[BOARD_SIZE][BOARD_SIZE] public board;
    int8 immutable EMPTY = ChessMediaLibrary.EMPTY;
    int8 immutable PAWN = ChessMediaLibrary.PAWN;
    int8 immutable KNIGHT = ChessMediaLibrary.KNIGHT;
    int8 immutable BISHOP = ChessMediaLibrary.BISHOP;
    int8 immutable ROOK = ChessMediaLibrary.ROOK;
    int8 immutable QUEEN = ChessMediaLibrary.QUEEN;
    int8 immutable KING = ChessMediaLibrary.KING;
    
    uint8 constant ROW_BLACK_PIECES = 0;
    uint8 constant ROW_BLACK_PAWNS = 1;
    uint8 constant ROW_BLACK_PAWNS_LONG_OPENING = 3;
    uint8 constant ROW_WHITE_PAWNS_LONG_OPENING = 4;
    uint8 constant ROW_WHITE_PAWNS = 6;
    uint8 constant ROW_WHITE_PIECES = 7;

    uint8 constant COL_SHORTW_LONGB_ROOK = 0;
    uint8 constant COL_UNNAMED_KNIGHT = 1;
    uint8 constant COL_BISHOP = 2;
    uint8 constant COL_QUEEN = 3;
    uint8 constant COL_KING = 4;
    uint8 constant COL_UNNAMED_BISHOP = 5;
    uint8 constant COL_KNIGHT = 6;
    uint8 constant COL_LONGW_SHORTB_ROOK = 7;
    
    int8 constant PLAYER_WHITE = 1;
    int8 constant PLAYER_BLACK = -1;
    

    bool private whiteKingMoved;
    bool private whiteShortRookMoved;
    bool private whiteLongRookMoved;

    bool private blackKingMoved;
    bool private blackLongRookMoved;
    bool private blackShortRookMoved;
    uint public betting;

    event Debug(int8 player, uint8 startX, uint8 startY, uint8 endX, uint8 endY, string comment);
    // Define the GameState enum
    enum GameState { NotStarted, InProgress, Draw, WhiteWins, BlackWins }
    // Add a gameState variable to the contract
    GameState private gameState = GameState.NotStarted;

    address whitePlayer;
    address blackPlayer;
    address currentPlayer;

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

    function switchTurn() public  {
        currentPlayer = (currentPlayer == whitePlayer) ? blackPlayer : whitePlayer;
    }

   function joinGameAsBlack() public payable {
        require(msg.sender != whitePlayer, "You are already the white player");
        require(msg.value == betting, "Please send the same amount as the white player");
        require(blackPlayer == address(0), "Black player slot is already taken");
        blackPlayer = msg.sender;
    }

    function initializeBoard() private {
        // Set up white pieces
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

        // Set up black pieces
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

        whiteKingMoved = false;
        whiteShortRookMoved = false;
        whiteLongRookMoved = false;
        blackKingMoved = false;
        blackLongRookMoved = false;
        blackShortRookMoved = false;
        
    }

    function abs(int8 x) private pure returns (uint8) {
        return x >= 0 ? uint8(x) : uint8(-x);
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
            if (piece == PAWN && endX == startX + 1 && target < 0) { // White pawn captures black piece
                return true;
            } 
            else
            if (piece == -PAWN && endX == startX - 1 && target > 0) { // Black pawn captures white piece
                return true;
            }
        }


        //TODO: to add the en-passant move
        
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


    function isKingInCheck(int8 player) private returns (bool) {
        // Find the position of the player's king
        uint8 kingX;
        uint8 kingY;
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                if (board[rowPiece][colPiece] == player * KING) {
                    kingX = rowPiece;
                    kingY = colPiece;
                }
            }
        }

        // Check if any of the opponent's pieces can attack the king
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                if (player * board[rowPiece][colPiece] < 0) { // Check if piece belongs to opponent
                    if (isValidMove(rowPiece, colPiece, kingX, kingY)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function isSquareUnderAttack(int8 player, uint8 x, uint8 y) internal returns (bool) {
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                //check if the opponent pieces can do a valid move to that square
                if (currentPlayer == whitePlayer && board[rowPiece][colPiece] * player < 0 && isValidMove(rowPiece, colPiece, x, y)
                || currentPlayer == blackPlayer && board[rowPiece][colPiece] * player > 0 && isValidMove(rowPiece,colPiece, x, y)) {
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

    function isCastlingValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 player) internal returns (bool) {
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

    function isValidMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private returns (bool) {
        int8 piece = board[startX][startY];
        int8 target = board[endX][endY];

        // Check if the move is a king move and update kingMoved accordingly
        if (abs(int8(endY) - int8(startY)) == COL_BISHOP && abs(piece) == uint8(KING)) {
            if (currentPlayer == whitePlayer) {
                if (startX == ROW_WHITE_PIECES && startY == COL_KING && !whiteKingMoved) {
                    // Check if it's a valid long castling
                    if ((uint8(ROOK) == abs(board[startX][COL_LONGW_SHORTB_ROOK]) && endY == COL_QUEEN && !whiteLongRookMoved)
                    // Check if it's a valid short castling
                    || (uint8(ROOK) == abs(board[startX][COL_SHORTW_LONGB_ROOK]) && endY == COL_BISHOP && !whiteShortRookMoved)){
                        return true;
                    }
                }
            } 
            else {
                if (startX == ROW_BLACK_PIECES && startY == COL_KING && !blackKingMoved) {
                    // Check if it's a valid short castling
                    if ((uint8(ROOK) == abs(board[startX][COL_SHORTW_LONGB_ROOK]) && endY == COL_KNIGHT && !blackShortRookMoved)
                    // Check if it's a valid long castling) {
                    || (uint8(ROOK) == abs(board[startX][COL_LONGW_SHORTB_ROOK]) && endY == COL_BISHOP && !blackLongRookMoved)){
                        return true;
                    }
                }
            }
            //it should never arrive here
            return false;
        }

        // Check if target square is empty or contains an opponent's piece
        if (target == EMPTY || piece * target < 0) {
            if (abs(piece) == uint8(PAWN)) {
                return isPawnMoveValid(startX, startY, endX, endY, piece, target);
            } 
            else 
            if (abs(piece) == uint8(KNIGHT)) {
                return isKnightMoveValid(startX, startY, endX, endY, piece, target);
            } 
            else 
            if (abs(piece) == uint8(BISHOP)) {
                return isBishopMoveValid(startX, startY, endX, endY, piece, target);
            }
            else 
            if (abs(piece) == uint8(ROOK)) {

                // Check if the move is a rook move and update rookMoved
                if (startX == ROW_WHITE_PIECES && startY == COL_SHORTW_LONGB_ROOK && !whiteShortRookMoved) {
                    whiteShortRookMoved = true;
                } 
                else 
                if (startX == ROW_WHITE_PIECES && startY == COL_LONGW_SHORTB_ROOK && !whiteLongRookMoved) {
                    whiteLongRookMoved = true;
                }
                else 
                if (startX == ROW_BLACK_PIECES && startY == COL_LONGW_SHORTB_ROOK && !blackLongRookMoved) {
                    blackLongRookMoved = true;
                }
                else 
                if (startX == ROW_BLACK_PIECES && startY == COL_SHORTW_LONGB_ROOK && !blackShortRookMoved) {
                    blackShortRookMoved = true;
                }
                
                return isRookMoveValid(startX, startY, endX, endY, piece, target);
            } 
            else 
            if (abs(piece) == uint8(QUEEN)) {
                return isQueenMoveValid(startX, startY, endX, endY, piece, target);
            } 
            else 
            if (abs(piece) == uint8(KING)) {
                return isKingMoveValid(startX, startY, endX, endY, piece, target);
            }
            
            
        }
        else{
        
        }

        return false;
    }

    function isPathClear(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private view returns (bool) {
        uint8 deltaX = endX > startX ? endX - startX : startX - endX;
        uint8 deltaY = endY > startY ? endY - startY : startY - endY;
        int8 stepX = (endX > startX) ? int8(1) : int8(-1);
        int8 stepY = endY > startY ? int8(1) : int8(-1);

        if (deltaX == deltaY) { 
            // Check if bishop or queen
            uint8 i = 1;
            while (i < deltaX) {
                if (EMPTY != board[uint(int(int8(startX) + int8(i) * stepX))][uint(int(int8(startY) + int8(i) * stepY))]) {
                    return false;
                }
                i++;
            }
        }
        else 
        if (startX == endX) { 
            // Check if rook or queen moves vertically
            uint8 i = 1;
            while (i < deltaY) {
                if (EMPTY != board[uint256(startX)][uint256(startY) + uint256(int256(int8(i) * int8(stepY)))]) {
                    return false;
                }
                i++;
            }
        }
        else 
        if (startY == endY) { 
            // Check if rook or queen moves horizontally
            uint8 i = 1;
            while (i < deltaX) {
                if (EMPTY != board[uint256(startX) + uint256(int256(int8(i) * stepX))][uint256(startY)]) {
                    return false;
                }
                i++;
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

    function makeMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) public onlyCurrentPlayer onlyOwnPieces(startX,startY){
        // Check if the game is in progress
        require(gameState == GameState.InProgress || gameState == GameState.NotStarted, "Game has not started or has ended");

        // Check if the move is valid
        require(isValidMove(startX, startY, endX, endY), "Invalid move");

        // Make the move
        board[endX][endY] = board[startX][startY];
        board[startX][startY] = EMPTY;

        // Check if the move is a king move and update kingMoved accordingly
        if (uint8(KING) == abs(int8(board[startX][startY])) && abs(int8(endY) - int8(startY)) == 2 ) {
            
            if (currentPlayer == whitePlayer) {
                if (whiteKingMoved){
                    revert("White king has already moved. cannot castle");
                }
                else{
                    whiteKingMoved = true;
                }
            } 
            else {
                if (blackKingMoved){
                    revert("Black king has already moved. cannot castle");
                }
                else{
                    blackKingMoved = true;
                }
            }

            // Move the rook during castling
            if (endY == 6) {
                // Right castling
                board[startX][5] = board[startX][COL_LONGW_SHORTB_ROOK];
                board[startX][COL_LONGW_SHORTB_ROOK] = EMPTY;
            } 
            else 
            if (endY == 2) {
                // Left castling
                board[startX][COL_QUEEN] = board[startX][COL_SHORTW_LONGB_ROOK];
                board[startX][COL_SHORTW_LONGB_ROOK] = EMPTY;
            }
        }

       // Check if the move resulted in a check or checkmate
        if (isKingInCheck(PLAYER_BLACK)) {
            gameState = isCheckmate(PLAYER_BLACK, endX, endY) ? GameState.WhiteWins : GameState.InProgress;
        } 
        else 
        if (isKingInCheck(PLAYER_WHITE)) {
            gameState = isCheckmate(PLAYER_WHITE, endX, endY) ? GameState.BlackWins : GameState.InProgress;
        }
        else {
            gameState = isStalemate() ? GameState.Draw : GameState.InProgress;
        }

        switchTurn();
    }

    // Check if the given player's king can move out of check
    function canKingMove(int8 player) internal returns (bool) {
        // find the king position of the current player
        uint8 kingX;
        uint8 kingY;

        for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
            for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
                if (board[colPiece][rowPiece] == player * KING) {
                    kingX = colPiece;
                    kingY = rowPiece;
                    break;
                }
            }
        }

        // check if the king can move on a free square
        for (int8 i = -1; i <= 1; i++) {
            for (int8 j = -1; j <= 1; j++) {
                int8 x = int8(kingX) + i;
                int8 y = int8(kingY) + j;
                if (x >= 0
                    && x < int8(BOARD_SIZE)
                    && y >= 0
                    && y < int8(BOARD_SIZE)
                    && (i != 0 
                        || j != 0
                    )
                ){
                    uint8 newX = uint8(x);
                    uint8 newY = uint8(j);

                    if (board[newX][newY] == EMPTY 
                        && isValidMove(kingX, kingY, newX, newY)) {
                        return true;
                    }
                }
            }
        }

        // Nessuna mossa valida per il re
        return false;

    }

    // Check if the game is in stalemate
    function isStalemate() internal returns (bool) {
        int8 player = (currentPlayer == whitePlayer) ? int8(PLAYER_WHITE) : int8(PLAYER_BLACK);

        //TODO I think this can be removed, since it is override by the for loops at the bottom
       // if (canKingMove(player)) {
       //     return false;
       // }

        // Check if there are other valid moves for current player pieces
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                // If we find a piece belonging to the current player, then check if it can perform a move
                if (board[rowPiece][colPiece] * player > 0 ) { 
                    for (uint8 row_target = 0; row_target < BOARD_SIZE; row_target++) {
                        for (uint8 col_target = 0; col_target < BOARD_SIZE; col_target++) {
                            if (board[row_target][col_target] != board[rowPiece][colPiece] 
                                && isValidMove(rowPiece, colPiece, row_target, col_target)) {
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
    function isCheckmate(int8 player, uint8 attackerI, uint8 attackerJ) internal returns (bool) {
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
    function canCaptureAttacker(int8 player, uint8 rowAttacker, uint8 colAttacker) internal returns (bool) {
        // Iterate over all pieces on the board
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                // Skip empty squares and pieces belonging to the attacker
                if (board[rowPiece][colPiece] == EMPTY || board[rowPiece][colPiece] * player < 0 || (rowPiece == rowAttacker && colPiece == colAttacker)) {
                    continue;
                }

                // Check if the piece can capture the attacking piece
                if (isValidMove(rowPiece, colPiece, rowAttacker, colAttacker)) {
                    // A piece can capture the attacking piece
                    return true;
                }
            }
        }

        // No piece can capture the attacking piece
        return false;
    }

    function canBlockAttack(uint8 rowAttacker, uint8 colAttacker) internal returns (bool) {
        // Iterate over all pieces on the board
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                // Determine the direction of the attack
                int8 deltaRow = int8(int(uint256(rowAttacker - rowPiece)));
                int8 dj = int8(int(uint256(colAttacker - colPiece)));
                // Determine the step size for moving along the attack direction
                int8 stepi = 0;
                int8 stepj = 0;
                if (deltaRow != 0) {
                    stepi = deltaRow / int8(int(uint(abs(deltaRow))));
                }
                if (dj != 0) {
                    stepj = dj / int8(int(uint(abs(dj))));
                }

                // Iterate over all squares along the attack direction
                uint8 currentI = uint8(int8(rowPiece) + stepi);
                uint8 colCurrent = uint8(int8(colPiece) + stepj);
                if (currentI < BOARD_SIZE && colCurrent < BOARD_SIZE) {
                    while (currentI != rowAttacker || colCurrent != colAttacker) {
                        if (currentI >= 0 && currentI < BOARD_SIZE && colCurrent >= 0 && colCurrent < BOARD_SIZE) {
                            // Check if the square can be blocked by a friendly piece
                            if (board[currentI][colCurrent] != EMPTY && board[currentI][colCurrent] * board[rowPiece][colPiece] > 0) {
                                // Check if the blocking piece can move to the blocking square
                                if (isValidMove(currentI, colCurrent, rowPiece, colPiece)) {
                                    // A piece can block the attack
                                    return true;
                                }
                            }
                        }

                        // Move to the next square along the attack direction
                        currentI = uint8(int8(currentI) + stepi);
                        colCurrent = uint8(int8(colCurrent) + stepj);
                    }
                }
            }
        }

        // No any piece can block the attack
        return false;
    }


    function printBoard() public view returns (string memory) {
    string memory boardString = "";

    for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
        for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
            // Aggiungi il valore del pezzo alla stringa
            boardString = string(abi.encodePacked(boardString, pieceToString(board[rowPiece][colPiece]), " "));
        }
        // Aggiungi una nuova riga alla fine di ogni riga della scacchiera
        boardString = string(abi.encodePacked(boardString, "\n"));
    }

    return boardString;
    }

    function pieceToString(int8 piece) internal view returns (string memory) {
        if (piece == EMPTY) {
            return "0";
        } 
        else 
        if (piece == PAWN) {
            return "1";
        } 
        else 
        if (piece == KNIGHT) {
            return "2";
        } 
        else 
        if (piece == BISHOP) {
            return "3";
        } 
        else 
        if (piece == ROOK) {
            return "4";
        } 
        else 
        if (piece == QUEEN) {
            return "5";
        } 
        else 
        if (piece == KING) {
            return "6";
        } 
        else 
        if (piece == -PAWN) {
            return "-1";
        } 
        else 
        if (piece == -KNIGHT) {
            return "-2";
        } 
        else 
        if (piece == -BISHOP) {
            return "-3";
        } 
        else 
        if (piece == -ROOK) {
            return "-4";
        } 
        else 
        if (piece == -QUEEN) {
            return "-5";
        } 
        else 
        if (piece == -KING) {
            return "-6";
        } 
        else {
            return "XXXX";
        }
    }

    // Add a function to get the curr   ent players
    function getCurrentPlayers() public view returns (address, address) {
        return (whitePlayer, blackPlayer);
    }

    function debugCreative(uint8 x, uint8 y, int8 piece) public returns (string memory) {
        board[x][y] = piece;
        return printBoard();
    }

    function printChessBoardLayoutSVG() external view returns (string memory) {
        return board.getCurrentBoard();
    }

    function getGameState () public view returns (uint8) {
        if (gameState == GameState.NotStarted) return 1;
        if (gameState == GameState.InProgress) return 2;
        if (gameState == GameState.Draw) return 3;
        if (gameState == GameState.WhiteWins) return 4;
        if (gameState == GameState.BlackWins) return 5;

        return 0;
    } 
}





