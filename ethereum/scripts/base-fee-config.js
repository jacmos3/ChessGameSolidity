const DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI = 1_000_000;
const MAX_BASE_PRIORITY_FEE_PER_GAS_WEI = 100_000_000;
const DEFAULT_BASE_MAX_FEE_PER_GAS_WEI = 5_000_000_000;
const MAX_BASE_MAX_FEE_PER_GAS_WEI = 5_000_000_000;
const MAX_PUBLIC_DEPLOYMENT_TRANSACTION_GAS = 8_000_000;
const PUBLIC_DEPLOYMENT_GAS_BUDGET = 100_000_000;

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

function parseBaseMaxFeePerGas(env = process.env) {
  const rawValue = env.BASE_MAX_FEE_PER_GAS_WEI;
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_BASE_MAX_FEE_PER_GAS_WEI;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error("BASE_MAX_FEE_PER_GAS_WEI must be a positive integer");
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("BASE_MAX_FEE_PER_GAS_WEI must be a positive safe integer");
  }
  if (value > MAX_BASE_MAX_FEE_PER_GAS_WEI) {
    throw new Error("BASE_MAX_FEE_PER_GAS_WEI exceeds the 5 gwei safety cap");
  }

  return value;
}

function parseBaseFeeConfig(env = process.env) {
  const maxPriorityFeePerGas = parseBaseMaxPriorityFeePerGas(env);
  const maxFeePerGas = parseBaseMaxFeePerGas(env);
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error(
      "BASE_MAX_PRIORITY_FEE_PER_GAS_WEI cannot exceed BASE_MAX_FEE_PER_GAS_WEI"
    );
  }
  return { maxPriorityFeePerGas, maxFeePerGas };
}

module.exports = {
  DEFAULT_BASE_MAX_FEE_PER_GAS_WEI,
  DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI,
  MAX_BASE_PRIORITY_FEE_PER_GAS_WEI,
  MAX_BASE_MAX_FEE_PER_GAS_WEI,
  MAX_PUBLIC_DEPLOYMENT_TRANSACTION_GAS,
  PUBLIC_DEPLOYMENT_GAS_BUDGET,
  parseBaseFeeConfig,
  parseBaseMaxFeePerGas,
  parseBaseMaxPriorityFeePerGas
};
