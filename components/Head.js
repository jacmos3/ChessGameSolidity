import React from 'react';
import { default as HTMLHead } from "next/head"; // Meta
/**
 * Meta HTML Head
 * @returns {ReactElement} HTML Head component
 */
function Head() {
  return (
    <HTMLHead>
      {/* Primary Meta Tags */}
      <title>Solidity Chess Game</title>
      <meta name="title" content="Solidity Chess Game" />
      <meta
        name="description"
        content="A Solidity ChessGame powered by a dynamic NFT model, completely living onchain thanks to SVG layouts"
      />

      {/* OG + Facebook */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content="www.google.com" />
      <meta property="og:title" content="Solidity Chess Game" />
      <meta
        property="og:description"
        content="A Solidity ChessGame powered by a dynamic NFT model, completely living onchain thanks to SVG layouts"
      />
      <meta property="og:image" content="https://www.google.com/meta.png" />

      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content="https://www.google.com" />
      <meta property="twitter:title" content="Solidity Chess Game" />
      <meta
        property="twitter:description"
        content="A Solidity ChessGame powered by a dynamic NFT model, completely living onchain thanks to SVG layouts"
      />
      <meta property="twitter:image" content="https://www.google.com/meta.png" />

      {/* Font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="true"
      />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&display=swap"
        rel="stylesheet"
      />
      <link rel = "stylesheet" href = "//cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.2.12/semantic.min.css" />
    </HTMLHead>
  );
}
export default Head;
