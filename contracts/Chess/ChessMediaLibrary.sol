// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "../Utility/Base64Library.sol";

library ChessMediaLibrary {
    int8 public constant EMPTY = 0;
    int8 public constant PAWN = 1;
    int8 public constant KNIGHT = 2;
    int8 public constant BISHOP = 3;
    int8 public constant ROOK = 4;
    int8 public constant QUEEN = 5;
    int8 public constant KING = 6;

    function toString(uint value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        
        uint temp = value;
        uint digits;
        
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);

        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }

        return string(buffer);
    }

    function getPieceCharacter(int8 piece, string memory x, string memory y) internal pure returns (string memory) {
        string memory token;
        bool isWhite = piece < 0 ? false : true;
        if (!isWhite){
            piece *= -1;
        }

        if (piece == KING) {
            token = "&#9812;";
        }
        else
        if (piece == QUEEN) {
            token = "&#9813;";
        }
        else
        if (piece == ROOK) {
            token = "&#9814;";
        }
        else
        if (piece == BISHOP) {
            token = "&#9815;";
        }
        else
        if (piece == KNIGHT) {
            token = "&#9816;";
        }
        else
        if (piece == PAWN) {
            token = "&#9817;";
        }
        /*
        else 
        if (piece == -KING) {
            token = "&#9818;";
        }
        else
        if (piece == -QUEEN) {
            token = "&#9819;";
        }
        else
        if (piece == -ROOK) {
            token = "&#9820;";
        }
        else
        if (piece == -BISHOP) {
            token = "&#9821;";
        }
        else
        if (piece == -KNIGHT) {
            token = "&#9822;";
        }
        else
        if (piece == -PAWN) {
            token = "&#9823;";
        }
        */
        else{
            token = "";
        }

        return generatePiece(token, x, y, isWhite ? "#fff" : "#000");
    }

    function metadata(uint256 tokenId) internal pure returns (string memory){
        //TODO
        tokenId = 1;
        string memory toRet = "";
        return toRet;
    }

    function getCurrentBoard(int8[8][8] memory board) external pure returns (string memory) {
        uint tokenId = 0;
        string memory result = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>";
        result = string(abi.encodePacked(result, getBoardSquares()));   
        string memory black = "<g fill='#000' font-family='arial unicode ms,Helvetica,Arial,sans-serif' font-size='40'>";
        string memory white = "<g fill='#fff' font-family='arial unicode ms,Helvetica,Arial,sans-serif' font-size='40'>";
        for (uint16 i = 0; i < 8; i++) {
            for (uint16 j = 0; j < 8; j++) {
                string memory x = toString(j * 50 + 25);
                string memory y = toString(i * 50 + 25);
                int8 piece = board[i][j];
                if (piece < 0){
                    black = string(abi.encodePacked(black, getPieceCharacter(piece, x, y)));
                }
                else
                if (piece > 0){
                    white = string(abi.encodePacked(white, getPieceCharacter(piece, x, y)));
                }
            }
        }

        result = string(abi.encodePacked(result, white, "</g>", black, "</g>", "</svg>"));
        
        string memory json = Base64Library.encode(bytes(string(abi.encodePacked('{"name": "Match #', toString(tokenId), '", "description": "This is a match", "image": "data:image/svg+xml;base64,', Base64Library.encode(bytes(result)), '","attributes":[',metadata(tokenId),']}'))));
        return string(abi.encodePacked('data:application/json;base64,', json));
        
    }

    function generatePiece(string memory s, string memory x, string memory y, string memory c) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<text x='", x, "' y='", y, "' text-anchor='middle' dy='.3em' stroke='", c, "' stroke-width='1'>", s, "</text>"
        ));
    }

    function generateSquare(string memory x, string memory y, string memory w, string memory h, string memory c) internal pure returns (string memory){
        return string(abi.encodePacked(
            "<rect x='", x,"' y='", y,"' width='",w,"' height='", h,"' fill='", c,"' />"
        ));

    }

    function getBoardSquares() internal pure returns (string memory){
        uint8 size = 50;
        
        string memory toRet = generateSquare("0","0","400","400","#808080");
        for (uint8 k = 0; k < 2; k++){
            for (uint16 i = 0 ; i < 4; i++){
                for (uint16 j = 0; j < 4; j++){
                    toRet = string(abi.encodePacked(toRet, generateSquare(toString(size * (2 * i + k)), toString(size * (2 * j + k)), toString(size), toString(size), "#D8D8D8")));
                }
            }
        }
        return toRet;
    }

}