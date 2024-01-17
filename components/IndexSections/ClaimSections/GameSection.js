import React, {Component} from 'react';
import {Container} from 'semantic-ui-react';
import ChessFactory from '../../../ethereum/build/ChessFactory_flattened.sol.json';
import styles from "../../../styles/components/claimSections/FetchNFTList.module.scss";
import log from 'ipfs-api/src/log';

class GameSection extends Component {

    constructor(props) {
        super(props);
        console.log("constructor");
        console.log(props.addressGame);
    }

    state = {
        game: {key: "", header: "", image: "", gameStatus: ""},
        loading: 0,
        errorMessage: "",
        startRow: null,
        startCol: null,
        endRow:null,
        endCol:null,
        turnAddress: "w",
        previousSelection:{
            piece:{
                id:null, style: null
             }, 
             highlight:false,
            square:{
                id:null, style:null
            }
        }
    }
    
    resetState = () => {
        this.setState({
            game: {key: "", header: "", image: "", gameStatus: ""},
            loading: 0,
            errorMessage: "",
            startRow: null,
            startCol: null,
            endRow:null,
            endCol:null,
            turnAddress: "w",
            previousSelection:{
                piece:{
                    id:null, style: null
                },
                highlight:false,
                square:{
                    id:null, style:null
                }
            }
        });
    }

    async componentDidMount() {
        var chain = this.props.state.web3Settings.chains
            .filter(chain => chain.id === this.props.state.web3Settings.networkId)[0];
        this.setState({
            chainName: chain.name,
            opensea: chain.opensea,
            openseaCard: chain.openseaCard + this.props.state.web3Settings.contractAddress + "/"
        });
        await this.fetchGame();
    }

    isNullOrUndefined(value) {
        return value === undefined || value === null;
    }

    fetchGame = async () => {
        console.log("fetch");
        this.setState({loading: this.state.loading + 1, errorMessage: ''})
        try {
            const chessCoreInstance = new this.props.state.web3.eth.Contract(ChessFactory.ChessCore.abi, this.props.addressGame);
            let players = await chessCoreInstance.methods.getPlayers().call();
            console.log("players:", players, ", account:", this.props.state.web3Settings.account);
            if (players[0] == this.props.state.web3Settings.account){
                this.setState({turnAddress: "w"});
                console.log("turnAddress: w");
            }
            else
            if (players[1] == this.props.state.web3Settings.account){
                this.setState({turnAddress: "b"});
                console.log("turnAddress: b");
            }
            else{
                console.log("just a visitor");
            }

            let currentPlayer = await chessCoreInstance.methods.getCurrentPlayer().call();
            console.log("currentPlayer: ", currentPlayer);
            if (currentPlayer == this.props.state.web3Settings.account){
                console.log("it's your turn");
            }
            else{
                console.log("it's not your turn");
            }

            let chessboard = await chessCoreInstance.methods.printChessBoardLayoutSVG().call()
                .then((result) => {
                    //console.log(result);
                    return JSON.parse(window.atob(result.split(',')[1]));
                })
                .catch((error) => {
                    this.setState({errorMessage: error.message});
                    console.log(error);
                });

            let gameStatus = await chessCoreInstance.methods.getGameState().call()
                .then((result) => {
                    return result;
                })
                .catch((error) => {
                    console.log(error);
                });
            
            if (gameStatus == 1){
                console.log("NOT STARTED");
                gameStatus = "Join Game";
            }
            else{
                console.log(gameStatus);

            }
            if (!!this.state.errorMessage) {
                this.setState({loading: this.state.loading - 1});
                return;
            }
            console.log(chessboard.name, gameStatus);
            var game = {"key": this.props.addressGame, "header": chessboard.name, "image": chessboard.image, "gameStatus": gameStatus};
            
            this.setState({game: game});

            const svgString = atob(chessboard.image.split(',')[1]);

            const imageContainer = document.getElementById('image-container');
            imageContainer.innerHTML = svgString;
            const blackSquaresGroup = document.getElementById('s');
            //remove all the existing squares, because they have no id
            if (blackSquaresGroup != null) {
                const existingRects = blackSquaresGroup.getElementsByTagName('rect');
                console.log(existingRects);
                for (let i = 0; i < existingRects.length; i++) {
                    blackSquaresGroup.removeChild(existingRects[i]);
                    console.log("removed");
                }
                
                //now I'm going to recreate all the squares with the correct id, so that I can use them to move the pieces
                let toRet = "";
                const blackSquare = "#808080";
                const whiteSquare = "#D8D8D8";
                let isWhite = true;
                const size = 50;
                for (let row = 0; row < 8; row++){
                    for (let col = 0; col < 8; col++){      
                        const newGroup = document.createElementNS("http://www.w3.org/2000/svg", 'g');
                        newGroup.setAttribute('font-family', 'arial unicode ms,Helvetica,Arial,sans-serif');
                        newGroup.setAttribute('font-size', '40');
                        const newRect = document.createElementNS("http://www.w3.org/2000/svg", 'rect');
                        newRect.setAttribute('id', String(col) + ',' + String(row));
                        newRect.setAttribute('class', 's');
                        newRect.setAttribute('x', String(size * row));
                        newRect.setAttribute('y', String(size * col));
                        newRect.setAttribute('width', String(size));
                        newRect.setAttribute('height', String(size));
                        newRect.setAttribute('fill', isWhite ? whiteSquare : blackSquare);

                        if (col != 7){
                            isWhite = !isWhite;
                        }
                        newGroup.appendChild(newRect);
                        blackSquaresGroup.appendChild(newGroup);

                    }
                }

                const chessPieces = document.querySelectorAll('.p');
                chessPieces.forEach(piece => {
                    console.log("id[0]:",piece.id[0], this.state.turnAddress);
                    if (piece.id[0] == this.state.turnAddress){
                        piece.setAttribute('draggable', 'true');
                        piece.setAttribute('style', 'cursor:pointer;');
                        piece.addEventListener('dragstart', this.handleDragStart);
                        piece.addEventListener('dragover', this.handleDragOver);
                        piece.addEventListener('drop', this.handleDrop);
                        piece.addEventListener('click', this.handlePieceClick);
                    }
                    else{
                        piece.setAttribute('style', 'cursor:not-allowed;');
                        piece.addEventListener('click', this.handleOpponentPieceClick);
                    }
                });
                const squares = document.querySelectorAll('.s');
                squares.forEach(square => {
                    square.addEventListener('dragover', this.handleDragOver);
                    square.addEventListener('drop', this.handleDrop);
                    square.addEventListener('click', this.handleSquareClick);
                });
            }
            else{
                console.log("blackSquaresGroup is null");
            }
        } 
        catch (err) {
            this.setState({errorMessage: err.message});
            console.log(err.message);
        }
        this.setState({loading: this.state.loading - 1});
        this.resetState();
    }
    
    handleOpponentPieceClick = (event) =>{
        event.preventDefault();
        console.log("Opponent piece click");
        console.log(event.target);

        if (!this.isNullOrUndefined(this.state.previousSelection.square)
            && !this.isNullOrUndefined(this.state.previousSelection.square.id)
            && !this.isNullOrUndefined(this.state.previousSelection.square.style)){
                    const previousSquare = this.state.previousSelection.square;
                    this.restoreSquare(previousSquare);
                    this.setState({
                        previousSelection:{
                            piece: this.state.previousSelection.piece,
                            //highlight: this.state.previousSelection.highlight, 
                            square:{
                                id:null, style:null
                            }
                        }
                    });
                    console.log("m");
                    return;
            }
            else{
                console.log("previousSelection square or something inside it is null or undefined");
                console.log(this.state.previousSelection.square);
            }

        //check if the user has already selected a piece
        if (!this.isNullOrUndefined(this.state.previousSelection) 
            && !this.isNullOrUndefined(this.state.previousSelection.piece)
            && !this.isNullOrUndefined(this.state.previousSelection.piece.id)
            && !this.isNullOrUndefined(this.state.previousSelection.piece.style)){

            console.log("parent node id: ",event.target.parentNode.parentNode);
            console.log("x, y: ", event.target.attributes.x.value, event.target.attributes.y.value);
            let x = (parseInt(event.target.attributes.x.value) - 25);
            let y = (parseInt(event.target.attributes.y.value) - 25);

            //get the element from the dom
            const square = document.getElementById(y/50 + ',' + x/50);
            console.log("square:",square);
            
            
            const previousSquare = this.state.previousSelection.square;
            this.restoreSquare(previousSquare);
            this.setState({
                previousSelection:{
                    piece: this.state.previousSelection.piece,
                    //highlight: this.state.previousSelection.highlight, 
                    square: square.cloneNode(true)
                }
            });
            let width = square.width.baseVal.value;
            let height = square.height.baseVal.value;
            square.setAttribute('style', 'stroke:yellow;stroke-width:2;stroke-opacity:0.9');
            square.setAttribute('width', String(width - 2));
            square.setAttribute('height', String(height - 2));
            square.setAttribute('x', String(x + 1));
            square.setAttribute('y', String(y + 1));


            console.log("square",square);
            this.setState({
                endRow: y / 50,
                endCol: x / 50,
                previousSelection:{
                    piece: this.state.previousSelection.piece,
                    highlight: true, 
                    square: this.state.previousSelection.square
                }
            });

            this.generateConfirmButton(event.target, event.target.parentNode.parentNode, x, y);
        }
        else{
            console.log("previousSelection or something inside it is null");
        }
    }

    handlePieceClick = (event) =>{
        event.preventDefault();
        console.log("Piece click");
        console.log(event.target);

        //reload the previous piece if present
        if (!this.isNullOrUndefined(this.state.previousSelection) 
            && !this.isNullOrUndefined(this.state.previousSelection.piece)
            && !this.isNullOrUndefined(this.state.previousSelection.piece.id)
            && !this.isNullOrUndefined(this.state.previousSelection.piece.style)){
            const previousPiece = document.getElementById(this.state.previousSelection.piece.id);
            console.log("previousPiece id: ",previousPiece);
            console.log(this.state.previousSelection.piece.style.cssText);
            previousPiece.setAttribute('style', "cursor:pointer");
        }
        else{
            console.log("previousSelection or something inside it is null");
        }

        //if the piece is not the same as the previous one, save its original style and color it yellow
        if (!this.isNullOrUndefined(event)
            && !this.isNullOrUndefined(event.target) 
            && !this.isNullOrUndefined(event.target.id)
            && !this.isNullOrUndefined(this.state.previousSelection)
            && !this.isNullOrUndefined(this.state.previousSelection.piece)
            && event.target.id != this.state.previousSelection.piece.id){
                this.setState({
                    previousSelection:{
                        piece: event.target.cloneNode(true),
                        highlight: true, 
                        square: this.restoreSquare(this.state.previousSelection.square)
                    }
                });
                event.target.setAttribute('style', 'cursor: pointer; fill: yellow; stroke: yellow; stroke-width: 1px');

                if (!this.isNullOrUndefined(event.target.attributes)
                    && !this.isNullOrUndefined(event.target.attributes.x)
                    && !this.isNullOrUndefined(event.target.attributes.y)
                    && !this.isNullOrUndefined(event.target.attributes.x.value)
                    && !this.isNullOrUndefined(event.target.attributes.y.value)){
                        let row = (parseInt(event.target.attributes.y.value) - 25)/50;
                        let col = (parseInt(event.target.attributes.x.value) - 25)/50;
                        this.setState({startRow:row, startCol:col});
                        console.log(event.target.attributes, ", ", row,",", col);
                }
            }
            else{
                this.setState({
                    previousSelection: {
                        piece:{
                            id:null, style: null
                        }, 
                        highlight: false,
                        square:this.restoreSquare(this.state.previousSelection.square)
                    }
                });
                this.resetState();
            }
    }

    restoreSquare = (previousSquare) =>{
        console.log("restoreSquare",previousSquare);
        const confirmButton = document.getElementById('confirmButton');
        if (!this.isNullOrUndefined(confirmButton)){
            confirmButton.remove();
            console.log("confirm button removed");
        }
        else{
            console.log("confirm button is null");
        }
        let restoringSquare = document.getElementById(this.state.previousSelection.square.id);
        if (!this.isNullOrUndefined(restoringSquare)
            && !this.isNullOrUndefined(previousSquare)
            && !this.isNullOrUndefined(previousSquare.style)
            && !this.isNullOrUndefined(previousSquare.attributes)
            && !this.isNullOrUndefined(previousSquare.attributes.width)
            && !this.isNullOrUndefined(previousSquare.attributes.height)
            && !this.isNullOrUndefined(previousSquare.attributes.x)
            && !this.isNullOrUndefined(previousSquare.attributes.y)
            && !this.isNullOrUndefined(previousSquare.attributes.fill)
        ){
            console.log( "attributes",previousSquare.attributes);
            restoringSquare.setAttribute('style', previousSquare.style.cssText);
            restoringSquare.setAttribute('width', previousSquare.attributes.width.value);
            restoringSquare.setAttribute('height',previousSquare.attributes.height.value);
            restoringSquare.setAttribute('x', previousSquare.attributes.x.value);
            restoringSquare.setAttribute('y', previousSquare.attributes.y.value);
            restoringSquare.setAttribute('fill', previousSquare.attributes.fill.value);

            
        }
        else{
            console.log("restoringSquare or previousSelection is null/undefined or they contains something null");
        }
        return previousSquare;
    }
    
    handleSquareClick = (event) =>{
        event.preventDefault();
        console.log("handleSquareClick");

        if (!this.isNullOrUndefined(this.state.previousSelection)){
            if (!this.isNullOrUndefined(this.state.previousSelection.piece)){
                if (!this.isNullOrUndefined(this.state.previousSelection.highlight)){
                    if (this.state.previousSelection.highlight == false){
                        console.log("previousSelection.highlight is false");
                        return;
                    }
                }
            }

            if (!this.isNullOrUndefined(this.state.previousSelection.square)
                && !this.isNullOrUndefined(this.state.previousSelection.square.id)
                && !this.isNullOrUndefined(this.state.previousSelection.square.style)){
                    const previousSquare = this.state.previousSelection.square;
                    this.restoreSquare(previousSquare);
            }
            else{
                console.log("previousSelection square or something inside it is null or undefined");
                console.log(this.state.previousSelection.square);
            }
        }

        //if the square is not the same as the previous one, save its original style and highlight it
        if (!this.isNullOrUndefined(event)
            && !this.isNullOrUndefined(event.target) 
            && !this.isNullOrUndefined(event.target.id)
            && !this.isNullOrUndefined(this.state.previousSelection)
            && !this.isNullOrUndefined(this.state.previousSelection.square)
            && !this.isNullOrUndefined(this.state.previousSelection.piece)
            && !this.isNullOrUndefined(this.state.previousSelection.piece.id)
            && event.target.id != this.state.previousSelection.square.id){
                
                //this.retrieveEndCoords(event.target);

                let row = event.target.id.split(',')[0];
                let col = event.target.id.split(',')[1];
                let element = document.getElementById(this.state.previousSelection.piece.id);
                let pieceX = (element.attributes.x.value - 25)/50;
                let pieceY = (element.attributes.y.value - 25)/50;
                if (pieceX == col && pieceY == row){
                    console.log("piece in the same square");
                    return;
                }
                else{
                    console.log("piece in a different square")
                    console.log("pieceX:",pieceX,", pieceY:",pieceY);
                    console.log("row:",row,", col:",col);
                }
                    
                this.setState({
                    previousSelection:{
                        piece: this.state.previousSelection.piece,
                        square: event.target.cloneNode(true)
                    },
                    endRow: row,
                    endCol: col
                });

                console.log("saved:",this.state.previousSelection.square);
                let x = parseInt(event.target.x.baseVal.value);
                let y = parseInt(event.target.y.baseVal.value);
                let width = parseInt(event.target.width.baseVal.value);
                let height = parseInt(event.target.height.baseVal.value);
                event.target.setAttribute('style', 'stroke:yellow;stroke-width:2;stroke-opacity:0.9');
                event.target.setAttribute('width', String(width - 2));
                event.target.setAttribute('height', String(height - 2));
                event.target.setAttribute('x', String(x + 1));
                event.target.setAttribute('y', String(y + 1));
                this.generateConfirmButton(event.target, event.target.parentNode.parentNode.parentNode, x, y);

        }
        else{
            console.log("setting previousSelection to null")
            this.setState({
                previousSelection: {
                    piece:this.state.previousSelection.piece,
                    square:{
                        id:null, style:null
                    }
                }
            });
        }
    };

    retrieveEndCoords = (target) =>{
        
    }
    generateConfirmButton = (target, parent, x, y) =>{
        console.log("generateConfirmButton");
        const parentGroup = target.parentNode;
        const text = document.createElementNS("http://www.w3.org/2000/svg","text");
        text.setAttribute('id', 'confirmButton');
        text.setAttribute('x', String(x + 25));
        text.setAttribute('y', String(y + 25));
        text.setAttribute('fill', 'yellow');
        text.setAttribute('font-size', '20');
        text.setAttribute('font-family', 'arial unicode ms,Helvetica,Arial,sans-serif');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('alignment-baseline', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('style', 'cursor:pointer');
        text.innerHTML = "✓";
        text.addEventListener('click', this.handleConfirmClick);
            parent.appendChild(text);
            
    }

    handleConfirmClick = (event) =>{
        event.preventDefault();
        console.log("confirm");
        if (!this.isNullOrUndefined(this.state.startRow)
            && !this.isNullOrUndefined(this.state.startCol)
            && !this.isNullOrUndefined(this.state.endRow)
            && !this.isNullOrUndefined(this.state.endCol)){
                this.makeMove(this.state.startRow, this.state.startCol, this.state.endRow, this.state.endCol);
        }
        else{
            console.log("something is null");
        }
    }

    handleDragStart = (event) => {
        console.log("dragstart");
        event.dataTransfer.setData('text/plain', event.target.parentNode.id);
        if (!this.isNullOrUndefined(event)
            && !this.isNullOrUndefined(event.target) 
            && !this.isNullOrUndefined(event.target.parentNode)
            && !this.isNullOrUndefined(event.target.parentNode.x)
            && !this.isNullOrUndefined(event.target.parentNode.x.baseVal) 
            && !this.isNullOrUndefined(event.target.parentNode.x.baseVal.length)
            && event.target.parentNode.x.baseVal.length > 0
            && !this.isNullOrUndefined(event.target.parentNode.y) 
            && !this.isNullOrUndefined(event.target.parentNode.y.baseVal) 
            && !this.isNullOrUndefined(event.target.parentNode.y.baseVal.length)
            && event.target.parentNode.y.baseVal.length > 0){
                let row = (event.target.parentNode.y.baseVal[0].value-25)/50;
                let col = (event.target.parentNode.x.baseVal[0].value-25)/50;
                this.setState({startRow:row, startCol:col});
            console.log(row, col);
        }
        else{
            console.log("there is something null in the event.target.parentNode");
        }
    }
    
    handleDragOver = (event) => {
        event.preventDefault();
    }
    
    handleDrop = async (event) => {
        event.preventDefault();
        console.log("drop");
        const data = event.dataTransfer.getData('text/plain');
        const draggedElement = document.getElementById(data);

        if (this.isNullOrUndefined(draggedElement)){
            return;
        }
        else{
            const dropTarget = event.target;
            
            this.findCoords(event.target, draggedElement);
            //this.setState({endRow:x, endCol:y});
            let startRow = this.state.startRow;
            let startCol = this.state.startCol;
            let endRow = this.state.endRow;
            let endCol = this.state.endCol;
            this.restoreSquare(this.state.previousSelection.square);

            this.makeMove(startRow, startCol, endRow, endCol);
            this.setState({loading: this.state.loading + 1, errorMessage: ''});
        }
    };

    findCoords = (dropTarget, draggedElement) => {
        console.log("findCoords");
        if (this.isNullOrUndefined(dropTarget) || this.isNullOrUndefined(draggedElement)){
            console.log("dropTarget or draggedElement is null");
            return;
        }

        let col = null;
        let row = null;
        if (dropTarget.nodeName.toLowerCase() === 'rect'){
            col = dropTarget.x.baseVal.value;
            row = dropTarget.y.baseVal.value;
            draggedElement.setAttribute('x', col + 25);
            draggedElement.setAttribute('y', row + 25);
            console.log(col/50,",",row/50);
            col = col/50;
            row = row/50;
            console.log(dropTarget.id);
        }
        else
        if (dropTarget.nodeName.toLowerCase() === 'text'){
            col = dropTarget.x.baseVal[0].value;
            row = dropTarget.y.baseVal[0].value;
            
            draggedElement.setAttribute('x', col);
            draggedElement.setAttribute('y', row);
            col = (col - 25)/50;
            row = (row - 25)/50;
            console.log(col,",",row);

            if (col == this.state.startCol && row == this.state.startRow){
                console.log("same square");
                return;
            }
            else{
                console.log("different square");
            }
            dropTarget.remove();
        }
        this.setState({endRow:row, endCol:col});
        console.log("col:",col,", row:",row);
    }

    makeMove = async (startRow, startCol, endRow, endCol) => {
        console.log("makeMove: ", startRow, ",", startCol, "_", endRow, ",", endCol);
        try {
            const chessCoreInstance = new this.props.state.web3.eth.Contract(ChessFactory.ChessCore.abi, this.props.addressGame);
            await chessCoreInstance.methods.makeMove(startRow, startCol, endRow, endCol).send({
                from: this.props.state.web3Settings.account
            });
        } catch (err) {
            this.setState({errorMessage: err.message});
            console.log(err.message);
        }
        this.setState({loading: this.state.loading - 1, errorMessage: ""});

        this.fetchGame();
    }

    render() {
        return (
                <Container>
                    <div style={{display: 'flex', flexFlow: 'column'}}>
                        <h1>Game {this.state.game.gameStatus}</h1>
                    </div>

                        <div id="image-container">
                            <img src={this.state.game.image} width="500px"/>
                            <h3>{this.state.game.header}</h3>
                        </div>
                        
                        <button onClick={() => this.props.resetActiveGame()}>Back</button>
                        <button onClick={() => this.fetchGame()}>Refresh</button>
                </Container>
           
        )
    };
}
export default GameSection;