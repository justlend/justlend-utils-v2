/*
 * Copyright 2026 Justlend V2 Utils. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  triggerV2,
  tronHexToAbiHex,
  triggerEnergy,
  view,
  MAX_UINT256,
  getNetworkType,
  getDefaultAccount,
  assertTronAddress,
} from "./blockchain";
import { TronWeb } from "tronweb";
import { toChainAmount, BigNumber } from "./helper";
import Config from "../config";

const { trxPrecision, contracts, resetToZeroTokens = [] } = Config;

const getContractsAddress = (type) => {
 return contracts[getNetworkType()]?.[type]
}

// TRX value paths convert a human-readable TRX amount into a SUN uint256
// (a `callValue` or an `assets` arg). Route them through the same boundary guard
// as the TRC20 paths' `toChainAmount` — finite, non-negative, ROUND_DOWN integer
// string — scaling by `trxPrecision` (10^6) so a negative amount can't
// two's-complement-wrap a uint256, and a NaN/fractional amount can't reach a
// callValue/asset sink.
const toTrxChainAmount = (amount) => {
  const a = new BigNumber(amount);
  if (!a.isFinite() || a.lt(0)) {
    throw new Error(`toTrxChainAmount: invalid TRX amount ${amount}`);
  }
  return a.times(trxPrecision).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
};

// True for TetherToken-class tokens (TRON USDT/USDJ) whose `approve` REVERTs on
// a non-zero→non-zero change and therefore needs an approve(0) reset first.
// Compares in canonical hex so Base58/hex inputs both match.
export const requiresAllowanceReset = (tokenAddress) => {
  let target;
  try {
    target = TronWeb.address.toHex(tokenAddress);
  } catch {
    return false;
  }
  return resetToZeroTokens.some((t) => {
    try {
      return TronWeb.address.toHex(t) === target;
    } catch {
      return false;
    }
  });
};

export const depositToVault = async (
  vaultAddress,
  amount,
  decimals,
  receiver,
  options = {},
) => {
  //function deposit(uint256 assets, address receiver) public returns (uint256 shares)
  const functionSelector = "deposit(uint256,address)";
  const parameters = [
    { type: "uint256", value: toChainAmount(amount, decimals) },
    { type: "address", value: receiver },
  ];

  const result = await triggerV2(
    vaultAddress,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const redeemFromVault = async (
  vaultAddress,
  assets,
  decimals,
  receiver,
  owner,
  shares,
  options = {},
) => {
  //function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares)
  let functionSelector = "withdraw(uint256,address,address)";
  //function redeem(uint256 shares, address payable receiver, address owner) external returns (uint256 assets)
  if (shares) functionSelector = "redeem(uint256,address,address)";
  const parameters = [
    {
      type: "uint256",
      value: shares ? shares : toChainAmount(assets, decimals),
    },
    { type: "address", value: receiver },
    { type: "address", value: owner },
  ];
  const result = await triggerV2(
    vaultAddress,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const supplyCollateral = async (
  marketParams,
  amount,
  decimals,
  onBehalf,
  moolahAddress = getContractsAddress('MoolahProxy'),
  options = {},
) => {
  //function supplyCollateral(MarketParams memory marketParams,uint256 assets,address onBehalf,bytes calldata data)
  const functionSelector =
    "supplyCollateral((address,address,address,address,uint256),uint256,address,bytes)";
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    { type: "uint256", value: toChainAmount(amount, decimals) },
    { type: "address", value: onBehalf },
    { type: "bytes", value: "0x" },
  ];
  const result = await triggerV2(
    moolahAddress,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const withdrawCollateral = async (
  marketParams,
  amount,
  decimals,
  onBehalf,
  receiver,
  moolahAddress = getContractsAddress('MoolahProxy'),
  options = {},
) => {
  //function withdrawCollateral(MarketParams calldata marketParams,uint256 assets,address onBehalf,address payable receiver)
  const functionSelector =
    "withdrawCollateral((address,address,address,address,uint256),uint256,address,address)";
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    { type: "uint256", value: toChainAmount(amount, decimals) },
    { type: "address", value: onBehalf },
    { type: "address", value: receiver },
  ];
  const result = await triggerV2(
    moolahAddress,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const borrow = async (
  marketParams,
  amount,
  decimals,
  onBehalf,
  receiver,
  moolahAddress = getContractsAddress('MoolahProxy'),
  options = {},
) => {
  //function borrow(MarketParams calldata marketParams,uint256 assets, uint256 shares,address onBehalf,address payable receiver) external returns (uint256 _assets, uint256 _shares)
  const functionSelector =
    "borrow((address,address,address,address,uint256),uint256,uint256,address,address)";
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    { type: "uint256", value: toChainAmount(amount, decimals) },
    { type: "uint256", value: 0 },
    { type: "address", value: onBehalf },
    { type: "address", value: receiver },
  ];
  const result = await triggerV2(
    moolahAddress,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const repay = async (
  marketParams,
  amount,
  decimals,
  sharesAmount,
  onBehalf,
  moolahAddress = getContractsAddress('MoolahProxy'),
  options = {},
) => {
  //function repay( MarketParams calldata marketParams,uint256 assets,uint256 shares,address onBehalf,bytes calldata data) external payable returns (uint256 _assets, uint256 _shares)
  const functionSelector =
    "repay((address,address,address,address,uint256),uint256,uint256,address,bytes)";
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    {
      type: "uint256",
      value: sharesAmount ? 0 : toChainAmount(amount, decimals),
    },
    { type: "uint256", value: sharesAmount ? sharesAmount : 0 },
    { type: "address", value: onBehalf },
    { type: "bytes", value: "0x" },
  ];
  const result = await triggerV2(
    moolahAddress,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const depositTrxToVault = async (
  vaultAddress,
  receiver,
  amount,
  trxProviderProxy = getContractsAddress('TrxProviderProxy'),
  options = {},
) => {
  //function deposit(address vault, address receiver) public payable returns (uint256 shares)
  const functionSelector = "deposit(address,address)";
  const callValue = toTrxChainAmount(amount);
  const parameters = [
    { type: "address", value: vaultAddress },
    { type: "address", value: receiver },
  ];

  const result = await triggerV2(
    trxProviderProxy,
    functionSelector,
    parameters,
    { callValue, ...options },
  );
  return result;
};

export const redeemTrxFromVault = async (
  vaultAddress,
  assets,
  vaultShareDecimals,
  shares,
  receiver,
  owner,
  trxProviderProxy = getContractsAddress('TrxProviderProxy'),
  options = {},
) => {
  //function withdraw(address vault, uint256 assets, address payable receiver, address owner) external returns (uint256 shares)
  let functionSelector = "withdraw(address,uint256,address,address)";
  //function redeem(address vault, uint256 shares, address payable receiver, address owner) external returns (uint256 assets)
  if (shares) functionSelector = "redeem(address,uint256,address,address)";
  const parameters = [
    { type: "address", value: vaultAddress },
    {
      type: "uint256",
      value: shares ? shares : toChainAmount(assets, vaultShareDecimals),
    },
    { type: "address", value: receiver }, // receiver
    { type: "address", value: owner }, // owner
  ];
  const result = await triggerV2(
    trxProviderProxy,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const supplyTrxAsCollateral = async (
  marketParams,
  onBehalf,
  amount,
  trxProviderProxy = getContractsAddress('TrxProviderProxy'),
  options = {},
) => {
  //function supplyCollateral(MarketParams calldata marketParams,address onBehalf, bytes calldata data) external payable
  const functionSelector =
    "supplyCollateral((address,address,address,address,uint256),address,bytes)";
  const callValue = toTrxChainAmount(amount);
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    { type: "address", value: onBehalf },
    { type: "bytes", value: "0x" },
  ];
  const result = await triggerV2(
    trxProviderProxy,
    functionSelector,
    parameters,
    { callValue, ...options },
  );
  return result;
};

export const borrowTrx = async (
  marketParams,
  amount,
  onBehalf,
  receiver,
  trxProviderProxy = getContractsAddress('TrxProviderProxy'),
  options = {},
) => {
  //function borrow(MarketParams calldata marketParams,uint256 assets,uint256 shares,address onBehalf, address payable receiver) external returns (uint256 _assets, uint256 _shares)
  const functionSelector =
    "borrow((address,address,address,address,uint256),uint256,uint256,address,address)";
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  const assets = toTrxChainAmount(amount);
  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    { type: "uint256", value: assets },
    { type: "uint256", value: 0 },
    { type: "address", value: onBehalf },
    { type: "address", value: receiver },
  ];
  const result = await triggerV2(
    trxProviderProxy,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const repayWithTrx = async (
  marketParams,
  amount,
  sharesAmount,
  onBehalf,
  sharesCallValueAmount,
  trxProviderProxy = getContractsAddress('TrxProviderProxy'),
  options = {},
) => {
  //function repay( MarketParams calldata marketParams,uint256 assets,uint256 shares,address onBehalf,bytes calldata data) external payable returns (uint256 _assets, uint256 _shares)
  const functionSelector =
    "repay((address,address,address,address,uint256),uint256,uint256,address,bytes)";
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  const assets = toTrxChainAmount(amount);
  let callValue = assets;
  if (sharesCallValueAmount) callValue = sharesCallValueAmount;

  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    { type: "uint256", value: sharesAmount ? 0 : assets },
    { type: "uint256", value: sharesAmount ? sharesAmount : 0 },
    { type: "address", value: onBehalf },
    { type: "bytes", value: "0x" },
  ];

  const result = await triggerV2(
    trxProviderProxy,
    functionSelector,
    parameters,
    {callValue, ...options},
  );
  return result;
};

export const withdrawTrxCollateral = async (
  marketParams,
  amount,
  onBehalf,
  receiver,
  trxProviderProxy = getContractsAddress('TrxProviderProxy'),
  options = {},
) => {
  const {
    borrowAddress: loanToken,
    collateralAddress: collateralToken,
    oracle,
    irm,
    lltv,
  } = marketParams;
  //function withdrawCollateral(MarketParams memory marketParams,uint256 assets,address onBehalf,address receiver)
  const functionSelector =
    "withdrawCollateral((address,address,address,address,uint256),uint256,address,address)";
  const assets = toTrxChainAmount(amount);
  const parameters = [
    {
      type: "(address,address,address,address,uint256)",
      value: [
        tronHexToAbiHex(loanToken),
        tronHexToAbiHex(collateralToken),
        tronHexToAbiHex(oracle),
        tronHexToAbiHex(irm),
        BigNumber(lltv).times(1e18).toString(),
      ],
    },
    { type: "uint256", value: assets },
    { type: "address", value: onBehalf }, // onBehalf
    { type: "address", value: receiver }, // receiver (payable)
  ];
  const result = await triggerV2(
    trxProviderProxy,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const estimateSupplyTrxGas = async (
  vaultAddress,
  amount,
  receiver,
  trxProviderProxy = getContractsAddress('TrxProviderProxy'),
  options = {},
) => {
  //function deposit(address vault, address receiver) public payable returns (uint256 shares)
  const functionSelector = "deposit(address,address)";
  const callValue = toTrxChainAmount(amount);
  const _options = { _isConstant: true, callValue, ...options };
  const parameters = [
    { type: "address", value: vaultAddress },
    { type: "address", value: receiver },
  ];
  const result = await triggerEnergy(
    trxProviderProxy,
    functionSelector,
    parameters,
    _options,
  );
  return result && result.energy_used;
};

// approve(token, spender, options?)
//   options.amount — exact uint256 string to approve (recommended).
//   options.unlimited — set `true` to explicitly opt in to MAX_UINT256.
//     Unlimited lets the spender move the full current+future balance of this
//     token if later compromised; revoke with
//     `approve(token, spender, { amount: '0' })`.
//   You MUST pass either `amount` or `unlimited: true` — omitting both no longer
//     silently grants MAX (that was an unlimited-by-default footgun).
//   options.* — forwarded to the broadcast (e.g. feeLimit).
// For TetherToken-class tokens (TRON USDT/USDJ) a non-zero→non-zero approve
// REVERTs, so we reset to 0 first when there is (or may be) a residual allowance.
export const approve = async (tokenAddress, spenderAddress, options = {}) => {
  assertTronAddress(tokenAddress, "token address");
  assertTronAddress(spenderAddress, "spender address");

  const { amount, unlimited, ...txOptions } = options;
  if (amount == null && unlimited !== true) {
    throw new Error(
      "approve: pass an exact { amount }, or set { unlimited: true } to opt " +
        "in to MAX_UINT256 approval",
    );
  }
  // An explicit { amount } is an already-scaled uint256 (base units); still route
  // it through the toChainAmount boundary guard (decimals 0 = identity scale) so
  // a negative amount can't two's-complement-wrap to ~MAX_UINT256 — an unlimited
  // approval that approve(MAX) pre-exec simulates OK and therefore can't backstop.
  // The explicit { unlimited: true } path keeps MAX_UINT256 unchanged.
  const value = amount != null ? toChainAmount(amount, 0) : MAX_UINT256;
  const functionSelector = "approve(address,uint256)";
  const buildParams = (v) => [
    { type: "address", value: spenderAddress },
    { type: "uint256", value: v },
  ];

  if (requiresAllowanceReset(tokenAddress)) {
    let needsReset;
    try {
      // getAllowance throws on read failure (vs returning a sentinel 0), so a
      // failed read can't masquerade as "zero allowance" and skip the reset.
      const current = await getAllowance(
        tokenAddress,
        getDefaultAccount(),
        spenderAddress,
      );
      needsReset = current.gt(0);
    } catch {
      needsReset = true; // read failed → conservatively reset
    }
    if (needsReset) {
      await triggerV2(tokenAddress, functionSelector, buildParams("0"), txOptions);
    }
  }

  const result = await triggerV2(
    tokenAddress,
    functionSelector,
    buildParams(value),
    txOptions,
  );
  return result;
};

export const getAllowance = async (
  tokenAddress,
  ownerAddress,
  spenderAddress,
) => {
  const funcSelector = "allowance(address,address)";
  const parameters = [
    { type: "address", value: ownerAddress },
    { type: "address", value: spenderAddress },
  ];
  const result = await view(tokenAddress, funcSelector, parameters);

  // A successful allowance read always returns a 1-element array (the encoded
  // uint256, even when the value is 0); `view()` returns [] only on read
  // failure. Fail closed so callers can't mistake a failed read for "0".
  if (!result.length) {
    throw new Error(`Failed to read allowance for token ${tokenAddress}`);
  }
  return new BigNumber(result[0], 16);
};

export const getMerkleRoot = async (
  merkleIndex,
  merkleDistributorAddress = getContractsAddress('MerkleDistributor'),
) => {
  //function merkleRoots(uint256) external view returns (bytes32)
  const funcSelector = "merkleRoots(uint256)";
  const parameters = [{ type: "uint256", value: merkleIndex }];
  const result = await view(merkleDistributorAddress, funcSelector, parameters);
  return result.length ? `0x${result[0]}` : null;
};

export const isClaimed = async (
  merkleIndex,
  index,
  merkleDistributorAddress = getContractsAddress('MerkleDistributor'),
) => {
  //function isClaimed(uint256,uint256) external view returns (bool)
  const funcSelector = "isClaimed(uint256,uint256)";
  const parameters = [
    { type: "uint256", value: merkleIndex },
    { type: "uint256", value: index },
  ];
  const result = await view(merkleDistributorAddress, funcSelector, parameters);
  return result.length ? new BigNumber(result[0], 16).gt(0) : false;
};

export const depositTrxToWtrx = async (
  amount,
  wtrxContractProxy = getContractsAddress('WtrxContractProxy'),
  options = {},
) => {
  //function deposit() external payable
  const functionSelector = "deposit()";
  const callValue = toTrxChainAmount(amount);
  const result = await triggerV2(
    wtrxContractProxy,
    functionSelector,
    [],
    { callValue, ...options },
  );
  return result;
};

export const getLoanTokenAmountNeed = async (
  marketId,
  seizedAssets,
  repaidShares,
  decimals,
  publicLiquidatorProxy = getContractsAddress('PublicLiquidatorProxy'),
) => {
  //function loanTokenAmountNeed(bytes32,uint256,uint256) external view returns (uint256)
  const funcSelector = "loanTokenAmountNeed(bytes32,uint256,uint256)";
  const parameters = [
    { type: "bytes32", value: marketId },
    {
      type: "uint256",
      value: repaidShares ? 0 : toChainAmount(seizedAssets, decimals),
    },
    { type: "uint256", value: repaidShares || 0 },
  ];
  const result = await view(publicLiquidatorProxy, funcSelector, parameters);
  // `view()` returns [] only on read failure (node 5xx/SERVER_BUSY/network/
  // revert); a successful read always yields a 1-element array (even when the
  // value is 0). Fail closed — mirror getAllowance — so liquidation callers
  // can't mistake a failed read for "0 loan token needed" and build an
  // under-approved / under-repaid liquidate tx that reverts on-chain.
  if (!result.length) {
    throw new Error(
      `Failed to read loanTokenAmountNeed for market ${marketId}`,
    );
  }
  return new BigNumber(result[0], 16);
};

export const liquidate = async (
  marketId,
  borrower,
  seizedAssets,
  repaidShares,
  decimals,
  publicLiquidatorProxy = getContractsAddress('PublicLiquidatorProxy'),
  options = {},
) => {
  assertTronAddress(borrower, "borrower address");
  //function liquidate(bytes32 marketId,address borrower,uint256 seizedAssets,uint256 repaidShares)
  const functionSelector = "liquidate(bytes32,address,uint256,uint256)";
  const parameters = [
    { type: "bytes32", value: marketId },
    { type: "address", value: borrower },
    {
      type: "uint256",
      value: repaidShares ? 0 : toChainAmount(seizedAssets, decimals),
    },
    { type: "uint256", value: repaidShares || 0 },
  ];
  const result = await triggerV2(
    publicLiquidatorProxy,
    functionSelector,
    parameters,
    options,
  );
  return result;
};

export const multiClaim = async (
  claims,
  merkleDistributorAddress = getContractsAddress('MerkleDistributor'),
  options = {},
) => {
  //function multiClaim((uint256 merkleIndex,uint256 index,uint256 amount,bytes32[] merkleProof)[])
  //function multiClaim((uint256 merkleIndex,uint256 index,uint256[] amounts,bytes32[] merkleProof)[]) - multi-token (NEW USDD) variant
  const isMultiToken = Array.isArray(claims?.[0]?.amount);
  const functionSelector = isMultiToken
    ? "multiClaim((uint256,uint256,uint256[],bytes32[])[])"
    : "multiClaim((uint256,uint256,uint256,bytes32[])[])";
  const tupleType = isMultiToken
    ? "(uint256,uint256,uint256[],bytes32[])[]"
    : "(uint256,uint256,uint256,bytes32[])[]";
  const parameters = [
    {
      type: tupleType,
      value: claims.map((c) => [
        c.merkleIndex,
        c.index,
        c.amount,
        c.merkleProof,
      ]),
    },
  ];
  const result = await triggerV2(
    merkleDistributorAddress,
    functionSelector,
    parameters,
    options,
  );
  return result;
};
