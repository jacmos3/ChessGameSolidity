import React, {Component} from 'react';
import {Container} from 'semantic-ui-react';
import ChessFactory from '../../../ethereum/build/ChessFactory_flattened.sol.json';
import styles from "../../../styles/components/claimSections/FetchNFTList.module.scss";

class GameSection extends Component {
    constructor(props) {
        super(props);
        console.log("constructor");
        console.log(props.addressGame);
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

    state = {
        game: {key: "", header: "", image: "", gameStatus: ""},
        loading: 0,
        errorMessage: ""
    };

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
            if (blackSquaresGroup != null) {
                const existingRect = blackSquaresGroup.querySelector('rect');
                if (existingRect) {
                    blackSquaresGroup.removeChild(existingRect);
                    console.log("removed");
                }
            

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
                        newRect.setAttribute('id', String(row) + ',' + String(col));
                        newRect.setAttribute('class', 's');
                        newRect.setAttribute('x', String(size * col));
                        newRect.setAttribute('y', String(size * row));
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
                });
                const squares = document.querySelectorAll('.s');
                squares.forEach(square => {
                    square.addEventListener('dragover', this.handleDragOver);
                    square.addEventListener('drop', this.handleDrop);
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

    handleDragStart(event) {
        console.log("dragstart");
        event.dataTransfer.setData('text/plain', event.target.parentNode.id);
        if (event != null && event.target != null && event.target.parentNode != null 
            && event.target.parentNode.x != null && event.target.parentNode.x.baseVal != null && event.target.parentNode.x.baseVal.length > 0
            && event.target.parentNode.y != null && event.target.parentNode.y.baseVal != null && event.target.parentNode.y.baseVal.length > 0){
            console.log((event.target.parentNode.x.baseVal[0].value-25)/50, (event.target.parentNode.y.baseVal[0].value-25)/50);
        }
        else{
            console.log("there is something null in the event.target.parentNode");
        }
    }
    
    handleDragOver(event) {
        event.preventDefault();
    }
    
    handleDrop(event) {
        event.preventDefault();
        console.log("drop");
        const data = event.dataTransfer.getData('text/plain');
        const draggedElement = document.getElementById(data);
        console.log(draggedElement.parentNode);

        const dropTarget = event.target;
        console.log(dropTarget.id);
        console.log(dropTarget.parentNode);
        console.log(draggedElement);
        console.log(dropTarget.x.baseVal.value);
        draggedElement.setAttribute('x', dropTarget.x.baseVal.value + 25);
        draggedElement.setAttribute('y', dropTarget.y.baseVal.value + 25);
        
        dropTarget.parentNode.appendChild(draggedElement);
    }

    render() {
        return (
                <Container>
                    <div style={{display: 'flex', flexFlow: 'column'}}>
                        <h1>Game {this.state.game.gameStatus}</h1>
                    </div>

                        <div id="image-container">
                            <img src={this.state.game.image} width="500px"/>
                            <h3>#{this.state.game.header}</h3>
                        </div>
                        
                        <button onClick={() => this.props.resetActiveGame()}>Back</button>
                </Container>
           
        )
    };
}
export default GameSection;
