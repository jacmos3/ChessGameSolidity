import React, { Component } from 'react';
import { Container } from 'semantic-ui-react';

class CourtesySection extends Component {
    render() {
        const { message, showConnectButton, connect, state } = this.props;
        const { web3Settings } = state;

        return (
            <Container>
                <div className="text-center py-12">
                    <div className="bg-gray-800 text-white p-8 rounded-lg max-w-md mx-auto">
                        <div className="text-5xl mb-4">
                            {showConnectButton ? '?' : '!'}
                        </div>

                        <p className="text-xl mb-6">{message}</p>

                        {showConnectButton && (
                            <button
                                className="bg-trips-3 text-white px-8 py-3 rounded-lg font-bold hover:bg-orange-600 transition-colors"
                                onClick={connect}
                            >
                                Connect Wallet
                            </button>
                        )}

                        {!showConnectButton && web3Settings.networkId && (
                            <div className="mt-4 text-sm text-gray-400">
                                <p>Current network: {web3Settings.networkName || web3Settings.networkId}</p>
                                <div className="mt-4">
                                    <p className="text-gray-300 mb-2">Supported networks:</p>
                                    <div className="flex flex-wrap justify-center gap-2">
                                        {web3Settings.chains.map(chain => (
                                            <span
                                                key={chain.id}
                                                className="bg-gray-700 px-3 py-1 rounded text-xs"
                                            >
                                                {chain.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Container>
        );
    }
}

export default CourtesySection;
