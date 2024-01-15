import React, {Component} from 'react';
import {Button, Container, Message, Tab} from 'semantic-ui-react';
import ChessFactory from '../../../ethereum/build/ChessFactory_flattened.sol.json';
import styles from "../../../styles/components/claimSections/FetchNFTList.module.scss";

class FetchNFTList extends Component {
    constructor(props) {
        super(props);
    }

    async componentDidMount() {
        var chain = this.props.state.web3Settings.chains
            .filter(chain => chain.id === this.props.state.web3Settings.networkId)[0];
        this.setState({
            chainName: chain.name,
            opensea: chain.opensea,
            openseaCard: chain.openseaCard + this.props.state.web3Settings.contractAddress + "/"
        });
        await this.fetchNFTList();
    }

    state = {
        all: [],
        loading: 0,
        errorMessage: "",
        totalChessGames:0,
    };
      
    fetchNFTList = async () => {
        console.log("fetch");
        this.setState({loading: this.state.loading + 1, errorMessage: ''})
        try {
            //const accounts = await this.props.state.web3.eth.getAccounts();
            const chessFactoryInstance = new this.props.state.web3.eth.Contract(ChessFactory.ChessFactory.abi, this.props.state.web3Settings.contractAddress);
            let deployedChessGames = await chessFactoryInstance.methods.getDeployedChessGames().call()
                .then((result) => {
                    return result;
                })
                .catch((error) => {
                    this.setState({errorMessage: error.message});
                    console.log("ERROR: ",error);
                })
                console.log(deployedChessGames);
            if (!!this.state.errorMessage) {
                this.setState({loading: this.state.loading - 1});
                return;
            }
            this.setState({totalChessGames: deployedChessGames.length});
            
            //TODO check su errorMessage e saltare tutto se c'è un errore
            var all = [];
            for (var i = 0; i < deployedChessGames.length; i++) {
                const chessCoreInstance = new this.props.state.web3.eth.Contract(ChessFactory.ChessCore.abi, deployedChessGames[i]);

                console.log(i);
                //    for (var index = 0; index < lastUserIndex; index++){
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
                else
                if (gameStatus == 2){
                    console.log("STARTED");
                    gameStatus = "Game Started";
                }
                else
                if (gameStatus == 3 || gameStatus == 4 ||  gameStatus == 5){
                    console.log("ENDED");
                    gameStatus = "Game Ended";
                    console.log(gameStatus);
                }
                else{
                    console.log("ERROR");
                    console.log(gameStatus);

                }
                if (!!this.state.errorMessage) {
                    this.setState({loading: this.state.loading - 1});
                    return;
                }

                var element = {"key": deployedChessGames[i], "header": chessboard.name, "image": chessboard.image, "gameStatus": gameStatus};
                all.push(element);
            }
            this.setState({all: all});
        } catch (err) {
            this.setState({errorMessage: err.message});
        }
        this.setState({loading: this.state.loading - 1});

    }

    render() {

        return (
            
                <Container>
                    <div style={{display: 'flex', flexFlow: 'column'}}>
                        <h2 className="text-center">There are {this.state.totalChessGames} open games on {this.state.chainName}</h2>

                        {!!this.state.errorMessage ? <Message header="Oops!" content={this.state.errorMessage}/> : ""}
                        {this.state.loading > 0 &&
                          <div className={`${styles.image__container}`}>
                          {
                            [...Array(this.state.totalChessGames)].map((elementInArray, index) => (

                            <div key={index}>
                                <div className={`${styles.image}`}>
                                  <img src = "/img/incognito.png" />
                                  <h3>#???</h3>
                                </div>
                            </div>
                          ))
                          }
                          </div>
                        }
                        {this.state.loading == 0 && <div className={`${styles.image__container}`}>
                            {
                                this.state.all.map(el => (
                                    <div key={el.key}>
                                        <div className={`${styles.image}`}>
                                            <a onClick={() => this.props.goToFetch(el.key)}>
                                                <img src={el.image} width="100px"/>
                                            </a>
                                          <h3>#{el.header}</h3>

                                          <h4>{el.gameStatus}</h4>
                                        </div>
                                    </div>
                                ))
                            }
                        </div>}
                        <div className={`${styles.buttons}`}>
                            <button className={`btn btn__primary`} disabled={this.state.loading > 0}
                                    onClick={this.fetchNFTList}>
                                Refresh List
                            </button>
                            <a target="_blank" href={this.state.opensea}>
                                <button className={`btn btn__primary btn__large`}>
                                    Open Full Collection on Opensea
                                </button>
                            </a>
                        </div>
                    </div>
                </Container>
           
        )
    };
}
export default FetchNFTList;
