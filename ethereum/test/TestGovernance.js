const ChessToken = artifacts.require("ChessToken");
const ChessTimelock = artifacts.require("ChessTimelock");
const ChessGovernor = artifacts.require("ChessGovernor");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: "2.0", method, params, id: Date.now() },
      (error, response) => {
        if (error) reject(error);
        else resolve(response.result);
      }
    );
  });
}

async function mineToBlock(targetBlock) {
  const currentBlock = await web3.eth.getBlockNumber();
  const blocks = Number(targetBlock) - currentBlock;
  if (blocks > 0) {
    await rpc("evm_mine", [{ blocks }]);
  }
}

async function expectRevert(promise) {
  try {
    await promise;
    assert.fail("Expected transaction to revert");
  } catch (error) {
    assert.include(error.message, "revert");
  }
}

contract("Chess governance", (accounts) => {
  const [admin, teamWallet, treasury, beneficiary] = accounts;
  const TIMELOCK_DELAY = 2;

  let token;
  let timelock;
  let governor;

  beforeEach(async () => {
    token = await ChessToken.new(teamWallet, treasury, { from: admin });
    timelock = await ChessTimelock.new(
      TIMELOCK_DELAY,
      [],
      [ZERO_ADDRESS],
      admin,
      { from: admin }
    );
    governor = await ChessGovernor.new(token.address, timelock.address, { from: admin });

    const proposerRole = await timelock.PROPOSER_ROLE();
    const cancellerRole = await timelock.CANCELLER_ROLE();
    await timelock.grantRole(proposerRole, governor.address, { from: admin });
    await timelock.grantRole(cancellerRole, governor.address, { from: admin });
  });

  it("uses the Base governance parameters documented for production", async () => {
    assert.equal((await governor.votingDelay()).toString(), "43200");
    assert.equal((await governor.votingPeriod()).toString(), "216000");
    assert.equal(
      (await governor.proposalThreshold()).toString(),
      web3.utils.toWei("100000", "ether")
    );
    assert.equal((await governor.quorumNumerator()).toString(), "4");
    assert.equal((await timelock.getMinDelay()).toString(), String(TIMELOCK_DELAY));
  });

  it("assigns proposal and cancellation authority to the governor", async () => {
    const proposerRole = await timelock.PROPOSER_ROLE();
    const cancellerRole = await timelock.CANCELLER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();

    assert.isTrue(await timelock.hasRole(proposerRole, governor.address));
    assert.isTrue(await timelock.hasRole(cancellerRole, governor.address));
    assert.isTrue(await timelock.hasRole(executorRole, ZERO_ADDRESS));
    assert.isFalse(await timelock.hasRole(proposerRole, admin));
  });

  it("executes an admin action only after delegation, voting, and timelock", async () => {
    await token.delegate(treasury, { from: treasury });

    const tokenAdminRole = await token.DEFAULT_ADMIN_ROLE();
    await token.grantRole(tokenAdminRole, timelock.address, { from: admin });
    await token.renounceRole(tokenAdminRole, admin, { from: admin });

    const amount = web3.utils.toWei("1", "ether");
    const calldata = token.contract.methods.mintTreasury(beneficiary, amount).encodeABI();
    const targets = [token.address];
    const values = ["0"];
    const calldatas = [calldata];
    const description = "Mint one CHESS through governance";
    const descriptionHash = web3.utils.keccak256(description);
    const proposalId = await governor.hashProposal(
      targets,
      values,
      calldatas,
      descriptionHash
    );

    await expectRevert(token.mintTreasury(beneficiary, amount, { from: admin }));
    await governor.propose(targets, values, calldatas, description, { from: treasury });

    const snapshot = await governor.proposalSnapshot(proposalId);
    await mineToBlock(snapshot.toNumber() + 1);
    assert.equal((await governor.state(proposalId)).toString(), "1", "proposal should be active");

    await governor.castVote(proposalId, 1, { from: treasury });
    const deadline = await governor.proposalDeadline(proposalId);
    await mineToBlock(deadline.toNumber() + 1);
    assert.equal((await governor.state(proposalId)).toString(), "4", "proposal should succeed");

    await governor.queue(targets, values, calldatas, descriptionHash, { from: treasury });
    assert.equal((await governor.state(proposalId)).toString(), "5", "proposal should be queued");

    await expectRevert(
      governor.execute(targets, values, calldatas, descriptionHash, { from: treasury })
    );

    await rpc("evm_increaseTime", [TIMELOCK_DELAY + 1]);
    await rpc("evm_mine");
    await governor.execute(targets, values, calldatas, descriptionHash, { from: beneficiary });

    assert.equal((await governor.state(proposalId)).toString(), "7", "proposal should be executed");
    assert.equal((await token.balanceOf(beneficiary)).toString(), amount);
  });
});
