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
        startX: null,
        startY: null,
        endX:null,
        endY:null,
        previousSelection:{piece:{id:null, style:null}, square:{id:null, style:null}}
    };

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
                    piece.setAttribute('draggable', 'true');
                    piece.addEventListener('dragstart', this.handleDragStart);
                    piece.addEventListener('dragover', this.handleDragOver);
                    piece.addEventListener('drop', this.handleDrop);
                    piece.addEventListener('click', this.handlePieceClick);
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
        } catch (err) {
            this.setState({errorMessage: err.message});
            console.log(err.message);
        }
        this.setState({loading: this.state.loading - 1});
    }

    handlePieceClick = (event) =>{
        event.preventDefault();
        console.log("click");
        console.log(event.target);

        //reload the previous piece if present
        if (!this.isNullOrUndefined(this.state.previousSelection) 
            && !this.isNullOrUndefined(this.state.previousSelection.piece)
            && !this.isNullOrUndefined(this.state.previousSelection.piece.id)
            && !this.isNullOrUndefined(this.state.previousSelection.piece.style)){
            const previousPiece = document.getElementById(this.state.previousSelection.piece.id);
            console.log("previousPiece id: ",previousPiece);
            previousPiece.setAttribute('style', this.state.previousSelection.piece.style);
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
                    piece: 
                        event.target
                    , 
                    square: this.state.previousSelection.square
                }
            });
            event.target.setAttribute('style', 'fill: yellow; stroke: yellow; stroke-width: 1');
        }
        else{
            this.setState({
                previousSelection: {
                    piece:{
                        id:null, style:null
                    }, 
                    square:this.state.previousSelection.square
                }
            });
        }
    }
    
    handleSquareClick = (event) =>{
        event.preventDefault();
        console.log("click");
        console.log("now:",event.target);

        //reload the previous square if present
        if (!this.isNullOrUndefined(this.state.previousSelection)
            && !this.isNullOrUndefined(this.state.previousSelection.square)
            && !this.isNullOrUndefined(this.state.previousSelection.square.id)
            && !this.isNullOrUndefined(this.state.previousSelection.square.style)){
            const previousSquare = this.state.previousSelection.square;
            console.log("previous:",previousSquare);
            let restoringSquare = document.getElementById(this.state.previousSelection.square.id);
        
            console.log( "cc",previousSquare.attributes);
            restoringSquare.setAttribute('style', previousSquare.style.cssText);
            restoringSquare.setAttribute('width', previousSquare.attributes.width.value);
            restoringSquare.setAttribute('height',previousSquare.attributes.height.value);
            restoringSquare.setAttribute('x', previousSquare.attributes.x.value);
            restoringSquare.setAttribute('y', previousSquare.attributes.y.value);
            restoringSquare.setAttribute('fill', previousSquare.attributes.fill.value);
            console.log("now:",event.target);
        }
        else{
            console.log("previousSelection or something inside it is null or undefined");
        }

        //if the square is not the same as the previous one, save its original style and highlight it
        if (!this.isNullOrUndefined(event)
            && !this.isNullOrUndefined(event.target) 
            && !this.isNullOrUndefined(event.target.id)
            && !this.isNullOrUndefined(this.state.previousSelection)
            && !this.isNullOrUndefined(this.state.previousSelection.square)
            && event.target.id != this.state.previousSelection.square.id){
                console.log("square is not the same");
                console.log(" previousSelection square",this.state.previousSelection.square);


            this.setState({
                previousSelection:{
                    piece: this.state.previousSelection.piece,
                    square: event.target.cloneNode(true)
                }
            });
            console.log("saved:",this.state.previousSelection.square);
            //event.target.setAttribute('style', 'fill: yellow; stroke: yellow; stroke-width: 1');

            let x = parseInt(event.target.x.baseVal.value);
            let y = parseInt(event.target.y.baseVal.value);
            let width = parseInt(event.target.width.baseVal.value);
            let height = parseInt(event.target.height.baseVal.value);
            event.target.setAttribute('style', 'stroke:pink;stroke-width:2;stroke-opacity:0.9');
            event.target.setAttribute('width', String(width - 2));
            event.target.setAttribute('height', String(height - 2));
            event.target.setAttribute('x', String(x + 1));
            event.target.setAttribute('y', String(y + 1));
            console.log("checking",this.state.previousSelection.square);
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
                let x = (event.target.parentNode.x.baseVal[0].value-25)/50;
                let y = (event.target.parentNode.y.baseVal[0].value-25)/50;
                this.setState({startX:x, startY:y});
            console.log(x, y);
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

        const dropTarget = event.target;
        let endX = null;
        let endY = null;
        if (dropTarget.nodeName.toLowerCase() === 'rect'){
            endX = dropTarget.x.baseVal.value;
            endY = dropTarget.y.baseVal.value;
            draggedElement.setAttribute('x', endX + 25);
            draggedElement.setAttribute('y', endY + 25);
            console.log(endX/50,",",endY/50);
            endX = endX/50;
            endY = endY/50;
            //dropTarget.parentNode.appendChild(draggedElement);
            console.log(dropTarget.id);
        }
        else
        if (dropTarget.nodeName.toLowerCase() === 'text'){
            endX = dropTarget.x.baseVal[0].value;
            endY = dropTarget.y.baseVal[0].value;
            
            draggedElement.setAttribute('x', endX);
            draggedElement.setAttribute('y', endY);
            endX = (endX - 25)/50;
            endY = (endY - 25)/50;
            console.log(endX,",",endY);
            //dropTarget.parentNode.appendChild(draggedElement);
            dropTarget.parentNode.removeChild(dropTarget);
        }
        //this.setState({endX:x, endY:y});
        this.setState({loading: this.state.loading + 1, errorMessage: ''})
        try {
            const accounts = await this.props.state.web3.eth.getAccounts();
            const chessCoreInstance = new this.props.state.web3.eth.Contract(ChessFactory.ChessCore.abi, this.props.addressGame);
            console.log("Sending tx: ", this.state.startY, ",", this.state.startX, "_", endY, ",", endX);
            await chessCoreInstance.methods.makeMove(this.state.startY, this.state.startX, endY, endX).send({from: accounts[0]});
        } 
        catch (err) {
            this.setState({errorMessage: err.message});
            console.log(err.code);
        }
        this.setState({loading: this.state.loading - 1, errorMessage: ""});
        this.fetchGame();
    };

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