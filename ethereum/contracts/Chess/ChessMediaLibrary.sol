// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "@openzeppelin/contracts/utils/Base64.sol";

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
        uint8[12] memory piecesCounter;
    

        for (uint16 row = 0; row < 8; row++) {
            for (uint16 col = 0; col < 8; col++) {
                string memory x = toString(col * 50 + 25);
                string memory y = toString(row * 50 + 25);
                int8 piece = board[row][col];         
                string memory token;
                string memory p;

                if (piece > 0){


                    if (piece == KING) {
                        token = "&#9812;";
                        piecesCounter[0] += 1;
                        p = string(abi.encodePacked("wkng",toString(piecesCounter[0])));
                    }
                    else
                    if (piece == QUEEN) {
                        token = "&#9813;";
                        piecesCounter[1] += 1;
                        p = string(abi.encodePacked("wqn",toString(piecesCounter[1])));
                    }
                    else
                    if (piece == ROOK) {
                        token = "&#9814;";
                        piecesCounter[2] += 1;
                        p = string(abi.encodePacked("wrk",toString(piecesCounter[2])));
                    }
                    else
                    if (piece == BISHOP) {
                        token = "&#9815;";
                        piecesCounter[3] += 1;
                        p = string(abi.encodePacked("wbshp",toString(piecesCounter[3])));
                    }
                    else
                    if (piece == KNIGHT) {
                        token = "&#9816;";
                        piecesCounter[4] += 1;
                        p = string(abi.encodePacked("wknght",toString(piecesCounter[4])));
                    }
                    else
                    if (piece == PAWN) {
                        token = "&#9817;";
                        piecesCounter[5] += 1;
                        p = string(abi.encodePacked("wpwn",toString(piecesCounter[5])));
                    }
                    //p = string(abi.encodePacked(p,"_",toString(row),",",toString(col)));
                    white = string(abi.encodePacked(white, generatePiece(token, x, y, "#fff", p)));
                }
                else
                if (piece < 0){
                    if (piece == -KING) {
                        token = "&#9812;";
                        piecesCounter[6] += 1;
                        p = string(abi.encodePacked("bkng",toString(piecesCounter[6])));
                    }
                    else
                    if (piece == -QUEEN) {
                        token = "&#9813;";
                        piecesCounter[7] += 1;
                        p = string(abi.encodePacked("bqn",toString(piecesCounter[7])));
                    }
                    else
                    if (piece == -ROOK) {
                        token = "&#9814;";
                        piecesCounter[8] += 1;
                        p = string(abi.encodePacked("brk",toString(piecesCounter[8])));
                    }
                    else
                    if (piece == -BISHOP) {
                        token = "&#9815;";
                        piecesCounter[9] += 1;
                        p = string(abi.encodePacked("bbshp",toString(piecesCounter[9])));
                    }
                    else
                    if (piece == -KNIGHT) {
                        token = "&#9816;";
                        piecesCounter[10] += 1;
                        p = string(abi.encodePacked("bknght",toString(piecesCounter[10])));
                    }
                    else
                    if (piece == -PAWN) {
                        token = "&#9817;";
                        piecesCounter[11] += 1;
                        p = string(abi.encodePacked("bpwn",toString(piecesCounter[11])));
                    }
                    //p = string(abi.encodePacked(p,":",toString(row),",",toString(col)));
                    black = string(abi.encodePacked(black, generatePiece(token, x, y, "#000", p)));
                    
                }
            }
        }

        result = string(abi.encodePacked(result, white, "</g>", black, "</g>", "</svg>"));
        
        string memory json = Base64.encode(bytes(string(abi.encodePacked('{"name": "Match #', toString(tokenId), '", "description": "This is a match", "image": "data:image/svg+xml;base64,', Base64.encode(bytes(result)), '","attributes":[',metadata(tokenId),']}'))));
        return string(abi.encodePacked('data:application/json;base64,', json));
        
    }

    function generatePiece(string memory s, string memory x, string memory y, string memory c, string memory piece) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<text id='", piece,"' class='p' x='", x, "' y='", y, "' text-anchor='middle' dy='.3em' stroke='", c, "' stroke-width='1'>", s, "</text>"
        ));
    }

    function generateSquare(string memory x, string memory y, string memory w, string memory h, string memory c) internal pure returns (string memory){
        return string(abi.encodePacked(
            "<rect x='", x,"' y='", y,"' width='",w,"' height='", h,"' fill='", c,"' />"
        ));

    }

    function getBoardSquares() internal pure returns (string memory){
        //square height and width
        uint8 size = 50;
        string memory toRet = string(abi.encodePacked("<g id='s'>", generateSquare("0","0","400","400","#808080")));
        for (uint8 k = 0; k < 2; k++){
            for (uint16 i = 0 ; i < 4; i++){
                for (uint16 j = 0; j < 4; j++){
                    toRet = string(abi.encodePacked(toRet, generateSquare(toString(size * (2 * i + k)), toString(size * (2 * j + k)), toString(size), toString(size), "#D8D8D8")));
                }
            }
        }
        toRet = string(abi.encodePacked(toRet,"</g>"));
        /*
        uint8 size = 50;
        string memory toRet = "";
        string memory blackSquare = "#808080";
        string memory whiteSquare = "#D8D8D8";
        bool isWhite = true;
        for (uint16 row = 0; row < 4; row++){
            for (uint16 col = 0; col < 8; col++){
                toRet = string(abi.encodePacked(toRet, generateSquare(toString(size * col), toString(size * row), toString(size), toString(size), (isWhite ? whiteSquare : blackSquare),string(abi.encodePacked(toString(row),",",toString(col))))));
                if (col != 7)
                    isWhite = !isWhite;
            }
        }
        */
        return toRet;
    }

}