const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");
const ChessNFT = artifacts.require("ChessNFT");

function decodeTokenUri(uri) {
  const prefix = "data:application/json;base64,";
  assert.isTrue(uri.startsWith(prefix), "tokenURI should contain base64 JSON");
  return JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
}

contract("ChessNFT", (accounts) => {
  const [whitePlayer, secondPlayer] = accounts;

  let factory;
  let nft;

  beforeEach(async () => {
    const implementation = await ChessCore.new();
    factory = await ChessFactory.new(implementation.address);
    nft = await ChessNFT.at(await factory.addressNFT());
  });

  it("mints one NFT per game to its creator", async () => {
    await factory.createChessGame(2, 0, {
      from: whitePlayer,
      value: web3.utils.toWei("0.01", "ether")
    });
    await factory.createChessGame(2, 0, {
      from: secondPlayer,
      value: web3.utils.toWei("0.01", "ether")
    });

    assert.equal(await nft.ownerOf(0), whitePlayer);
    assert.equal(await nft.ownerOf(1), secondPlayer);
    assert.notEqual(await nft.getGameAddress(0), await nft.getGameAddress(1));
  });

  it("uses the real game id in each token metadata document", async () => {
    await factory.createChessGame(2, 0, {
      from: whitePlayer,
      value: web3.utils.toWei("0.01", "ether")
    });
    await factory.createChessGame(2, 0, {
      from: secondPlayer,
      value: web3.utils.toWei("0.01", "ether")
    });

    const firstMetadata = decodeTokenUri(await nft.tokenURI(0));
    const secondMetadata = decodeTokenUri(await nft.tokenURI(1));

    assert.equal(firstMetadata.name, "MyChess Match #0");
    assert.equal(secondMetadata.name, "MyChess Match #1");
    assert.deepEqual(firstMetadata.attributes, [{ trait_type: "Game ID", value: 0 }]);
    assert.deepEqual(secondMetadata.attributes, [{ trait_type: "Game ID", value: 1 }]);
    assert.match(firstMetadata.image, /^data:image\/svg\+xml;base64,/);
  });

  it("rejects metadata requests for games that do not exist", async () => {
    try {
      await nft.tokenURI(999);
      assert.fail("Expected tokenURI to revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });
});
