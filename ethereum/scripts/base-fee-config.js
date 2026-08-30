const DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI = 1_000_000;
const MAX_BASE_PRIORITY_FEE_PER_GAS_WEI = 100_000_000;
const MAX_BASE_MAX_FEE_PER_GAS_WEI = 5_000_000_000;

function parseBaseMaxPriorityFeePerGas(env = process.env) {
  const rawValue = env.BASE_MAX_PRIORITY_FEE_PER_GAS_WEI;
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error("BASE_MAX_PRIORITY_FEE_PER_GAS_WEI must be a positive integer");
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("BASE_MAX_PRIORITY_FEE_PER_GAS_WEI must be a positive safe integer");
  }
  if (value > MAX_BASE_PRIORITY_FEE_PER_GAS_WEI) {
    throw new Error("BASE_MAX_PRIORITY_FEE_PER_GAS_WEI exceeds the 0.1 gwei safety cap");
  }

  return value;
}

module.exports = {
  DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI,
  MAX_BASE_PRIORITY_FEE_PER_GAS_WEI,
  MAX_BASE_MAX_FEE_PER_GAS_WEI,
  parseBaseMaxPriorityFeePerGas
};
