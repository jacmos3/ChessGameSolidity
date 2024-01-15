import React, {Component} from 'react';

import Web3 from "web3";
import Web3Modal from "web3modal";
import WalletConnectProvider from "@walletconnect/web3-provider";

import {Button} from 'semantic-ui-react';
class Game extends Component{
  state = {
    address: ''
  };

  
  async componentDidMount(){
    const params = new URLSearchParams(document.location.search);
    const address = params.get("address");
    console.log(address);
    this.setState({address: address});
    
  }


  render(){
    return(
      <div>
        <h1>Game</h1>
        {this.props.address}
          <a>
            <Button primary floated="right" style={{marginBottom:10}}> Add Requests! </Button>
          </a>
         

        
         
      </div>
    );
  }
}

export default Game;
