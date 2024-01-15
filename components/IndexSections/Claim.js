import React, {Component} from 'react';
import {Container, Button, Tab} from 'semantic-ui-react';
import styles from "../../styles/components/Claim.module.scss"; // Styles
import FetchNFTList from "./ClaimSections/FetchNFTList"
import GameSection from "./ClaimSections/GameSection"
import CourtesySection from "./ClaimSections/CourtesySection"

class Claim extends Component {
    state = {
        activeGame: -1
    }

    constructor(props) {
        super(props);
        this.goToFetch = this.goToFetch.bind(this);
    }

    //handleTabChange = (e, {activeGame}) => this.setState({activeGame});

    resetActiveGame = () => this.setState({activeGame: -1});

    goToFetch(game) {
      this.setState({activeGame:game});
      console.log("goToFetch");
      //console.log(game);
    }

    render() {
        var option = this.props.state.web3Settings.chains
            .filter(chain => chain.id === this.props.state.web3Settings.networkId)
            .map(chain => chain.options)[0];

       
        return (
            <div className={`${styles.claim__container} py-10 text-trips-1`}>
                <div className="flex justify-around">
                    <div className={`${styles.container} rounded`}>
                        <h2 className={`${styles.title} text-center mt-4 capitalize`}>Choose your Game</h2>
                        <br/>
                            {
                               

                            this.props.state.web3Settings.isWeb3Connected
                                ? this.props.state.web3Settings.chains
                                    .filter(chain => chain.id === this.props.state.web3Settings.networkId)
                                    .map(chain => chain.options.id).length == 1
                                    ? this.state.activeGame != -1
                                        ? (
                                            <div>
                                                <GameSection state={this.props.state} goToFetch={this.goToFetch} addressGame = {this.state.activeGame} resetActiveGame = {this.resetActiveGame} />
                                            </div>
                                        )
                                        : (
                                            <div>
                                                <FetchNFTList state={this.props.state} goToFetch={this.goToFetch}/>
                                            </div>
                                        )
                                    : (
                                        <div>
                                            <CourtesySection state={this.props.state} buttons= {false} connect={this.props.connect}/>
                                        </div>
                                    )
                                : (
                                    <div>
                                        <CourtesySection state={this.props.state} buttons= {true} connect={this.props.connect} />
                                    </div>
                                
                            )
                        }
                    </div>
                </div>
            </div>
        );
    };
}

export default Claim;
