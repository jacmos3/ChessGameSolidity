const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_BASE_MAX_FEE_PER_GAS_WEI,
  DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI,
  MAX_BASE_MAX_FEE_PER_GAS_WEI,
  MAX_BASE_PRIORITY_FEE_PER_GAS_WEI,
  parseBaseFeeConfig,
  parseBaseMaxFeePerGas,
  parseBaseMaxPriorityFeePerGas
} = require("./base-fee-config");

test("Base fee settings use conservative defaults", () => {
  assert.equal(parseBaseMaxPriorityFeePerGas({}), DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI);
  assert.equal(DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI, 1_000_000);
  assert.equal(parseBaseMaxFeePerGas({}), DEFAULT_BASE_MAX_FEE_PER_GAS_WEI);
  assert.equal(DEFAULT_BASE_MAX_FEE_PER_GAS_WEI, 5_000_000_000);
});

test("Base fee settings accept explicit integer overrides", () => {
  assert.equal(parseBaseMaxPriorityFeePerGas({ BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: "2500000" }), 2_500_000);
  assert.equal(
    parseBaseMaxPriorityFeePerGas({ BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: String(MAX_BASE_PRIORITY_FEE_PER_GAS_WEI) }),
    MAX_BASE_PRIORITY_FEE_PER_GAS_WEI
  );
  assert.equal(parseBaseMaxFeePerGas({ BASE_MAX_FEE_PER_GAS_WEI: "100000000" }), 100_000_000);
  assert.equal(
    parseBaseMaxFeePerGas({ BASE_MAX_FEE_PER_GAS_WEI: String(MAX_BASE_MAX_FEE_PER_GAS_WEI) }),
    MAX_BASE_MAX_FEE_PER_GAS_WEI
  );
  assert.deepEqual(parseBaseFeeConfig({
    BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: "1000000",
    BASE_MAX_FEE_PER_GAS_WEI: "1000000"
  }), {
    maxPriorityFeePerGas: 1_000_000,
    maxFeePerGas: 1_000_000
  });
});

test("Base fee settings reject unsafe or malformed overrides", () => {
  for (const value of ["0", "-1", "1.5", "fast", "9007199254740992"]) {
    assert.throws(
      () => parseBaseMaxPriorityFeePerGas({ BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: value }),
      /positive/
    );
    assert.throws(
      () => parseBaseMaxFeePerGas({ BASE_MAX_FEE_PER_GAS_WEI: value }),
      /positive/
    );
  }
});

test("Base fee settings reject values above their economic caps", () => {
  assert.throws(
    () => parseBaseMaxPriorityFeePerGas({ BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: "100000001" }),
    /0.1 gwei safety cap/
  );
  assert.throws(
    () => parseBaseMaxFeePerGas({ BASE_MAX_FEE_PER_GAS_WEI: "5000000001" }),
    /5 gwei safety cap/
  );
  assert.throws(
    () => parseBaseFeeConfig({
      BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: "1000000",
      BASE_MAX_FEE_PER_GAS_WEI: "999999"
    }),
    /cannot exceed/
  );
});
