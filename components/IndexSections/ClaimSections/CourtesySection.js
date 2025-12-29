import React, { Component } from 'react';
import { Container } from 'semantic-ui-react';

class CourtesySection extends Component {
    render() {
        const { message, showConnectButton, connect, state } = this.props;
        const { web3Settings } = state;

        return (
            <Container>
                <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                    <div style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(228, 168, 83, 0.1)',
                        borderRadius: '16px',
                        padding: '48px 32px',
                        maxWidth: '450px',
                        margin: '0 auto'
                    }}>
                        <div style={{
                            fontSize: '3.5rem',
                            marginBottom: '20px',
                            color: '#e4a853'
                        }}>
                            {showConnectButton ? '♞' : '⚠'}
                        </div>

                        <p style={{
                            fontSize: '1.2rem',
                            color: '#f5f5f5',
                            marginBottom: '24px',
                            lineHeight: 1.6
                        }}>
                            {message}
                        </p>

                        {showConnectButton && (
                            <button
                                onClick={connect}
                                style={{
                                    background: '#e4a853',
                                    color: '#1a1a2e',
                                    padding: '14px 32px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    fontSize: '1rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={(e) => e.target.style.background = '#f0b860'}
                                onMouseOut={(e) => e.target.style.background = '#e4a853'}
                            >
                                Connect Wallet
                            </button>
                        )}

                        {!showConnectButton && web3Settings.networkId && (
                            <div style={{ marginTop: '24px', color: '#6b7280', fontSize: '0.9rem' }}>
                                <p>Current network: <span style={{ color: '#f5f5f5' }}>{web3Settings.networkName || web3Settings.networkId}</span></p>
                                <div style={{ marginTop: '16px' }}>
                                    <p style={{ color: '#9ca3af', marginBottom: '12px' }}>Supported networks:</p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
                                        {web3Settings.chains.map(chain => (
                                            <span
                                                key={chain.id}
                                                style={{
                                                    background: 'rgba(228, 168, 83, 0.1)',
                                                    border: '1px solid rgba(228, 168, 83, 0.2)',
                                                    padding: '6px 12px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.85rem',
                                                    color: '#e4a853'
                                                }}
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
