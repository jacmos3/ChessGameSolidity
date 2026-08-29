const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI,
  parseBaseMaxPriorityFeePerGas
} = require("./base-fee-config");

test("Base priority fee uses a conservative default", () => {
  assert.equal(parseBaseMaxPriorityFeePerGas({}), DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI);
  assert.equal(DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI, 1_000_000);
});

test("Base priority fee accepts an explicit integer override", () => {
  assert.equal(parseBaseMaxPriorityFeePerGas({ BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: "2500000" }), 2_500_000);
});

test("Base priority fee rejects unsafe or malformed overrides", () => {
  for (const value of ["0", "-1", "1.5", "fast", "9007199254740992"]) {
    assert.throws(
      () => parseBaseMaxPriorityFeePerGas({ BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: value }),
      /positive/
    );
  }
});
