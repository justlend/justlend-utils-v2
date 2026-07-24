<p align="center">
  <a href="https://app.justlend.org/">
    <img src="https://app.justlend.org/mainLogo.svg" alt="JustLend DAO Logo" width="180">
  </a>
</p>

<h1 align="center">JustLend V2 Utils</h1>

<p align="center">
    <img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg">
    <img alt="TRON Network" src="https://img.shields.io/badge/Network-TRON-red">
    <img alt="Protocol: JustLend DAO" src="https://img.shields.io/badge/Protocol-JustLend_DAO-green">
    <img alt="CI" src="https://github.com/justlend/justlend-utils-v2/actions/workflows/ci.yml/badge.svg">
</p>

This is a utility library designed for interacting with the JustLend V2 protocol smart contracts on the TRON network. It encapsulates complex contract interaction logic (such as deposits, borrowing, and collateral management) and provides support for both native TRX and TRC20 tokens.

The project includes core blockchain tool wrappers, helper functions, and a React-based example application.

## Table of Contents

* [Features](#features)
* [Installation](#installation)
* [Usage](#usage)
* [API Overview](#api-overview)
* [Development](#development)
* [Project Structure](#project-structure)
* [Configuration](#configuration)
* [License](#license)

## Features

* **Vault Interactions**: Supports standard ERC4626-style vault operations, including depositing (`depositToVault`) and redeeming (`redeemFromVault`).
* **Lending Market**: Encapsulates core lending logic, including:
    * Supplying Collateral (`supplyCollateral`)
    * Withdrawing Collateral (`withdrawCollateral`)
    * Borrowing (`borrow`)
    * Repaying (`repay`).
* **Native TRX Support**: Provides specialized proxy methods for handling native TRX interactions, including `depositTrxToVault`, `borrowTrx`, `depositTrxToWtrx` for TRX → WTRX wrapping, and `withdrawTrxFromWtrx` for WTRX → TRX unwrapping.
* **Liquidation**: Public-liquidator entry points — preview the loan-token amount required (`getLoanTokenAmountNeed`) and execute the seizure (`liquidate`).
* **V2 Mining Rewards**: Merkle-based reward distribution — query Merkle root readiness (`getMerkleRoot`), check per-user claim status (`isClaimed`), and batch-claim across rounds (`multiClaim`, with single-token and multi-token / NEW USDD variants).
* **Energy Estimation**: Includes tools for estimating transaction energy consumption (`estimateSupplyTrxGas`).
* **Data Formatting**: Built-in `BigNumber` handling and amount formatting utilities.
* **Wallet Adapter**: Integrated with `@tronweb3` wallet adapters, supporting TronLink.

## Installation

This library is not published to npm. Install it directly from GitHub:

```bash
# Install via GitHub
npm install github:justlend/justlend-utils-v2
# or
pnpm add github:justlend/justlend-utils-v2
```

`tronweb` and `bignumber.js` are pulled in automatically as dependencies — no separate install needed.

## Usage

### 1. Initialization

This library requires a valid `TronWeb` instance to sign and broadcast transactions. **You must inject the TronWeb instance before calling any contract methods.**

**Option A: Browser (TronLink / Wallet Adapters)**

```javascript
import { tronObj } from 'justlend-v2-utils';

// Call this after the wallet is connected and ready
if (window.tronWeb && window.tronWeb.ready) {
  tronObj.tronWeb = window.tronWeb;
  
  // Set the sender address used for write transactions. Either global works;
  // `tronObj.defaultAccount` takes precedence over `window.defaultAccount`.
  tronObj.defaultAccount = window.tronWeb.defaultAddress.base58;
}

```

**Option B: Node.js (Server-side)**

```javascript
import { TronWeb } from 'tronweb';
import { tronObj } from 'justlend-v2-utils';

const tronWeb = new TronWeb({
  fullHost: 'https://nile.trongrid.io', // use https://api.trongrid.io for Mainnet
  privateKey: process.env.PRIVATE_KEY
});

// Inject the instance with private key
tronObj.tronWeb = tronWeb;

// Required in Node (there is no `window`): set the sender address explicitly.
tronObj.defaultAccount = tronWeb.defaultAddress.base58;

// Optional: pin the network instead of inferring it from the node host.
// tronObj.network = 'nile'; // 'main' | 'nile' | 'shasta'

```

### 2. Contract Interactions

**Deposit to Vault**

```javascript
import { depositToVault, approve, getAllowance, toChainAmount } from 'justlend-v2-utils';

const handleDeposit = async () => {
  const vaultAddress = "THwTBAmVoZTp4NY6HxJUHGDFGerDn9vuEW"; 
  const assetAddress = "TPYwAC9Y4uUcT2QH3WPPjqxzJSJWymMoMS";
  const userAddress = "TUserAddress...";
  const amount = "100"; // Amount in human-readable format (e.g., 100 USDT)
  const decimals = 6;

  // 1. Check Allowance
  const allowance = await getAllowance(assetAddress, userAddress, vaultAddress);
  const chainAmount = toChainAmount(amount, decimals);

  // 2. Approve if needed
  if (allowance.lt(chainAmount)) {
    console.log("Approving...");
    await approve(assetAddress, vaultAddress);
  }

  // 3. Deposit
  const res = await depositToVault(vaultAddress, amount, decimals, userAddress);
  console.log("TxID:", res.transaction.txID);
};

```

**Supply Collateral**

```javascript
import { supplyCollateral } from 'justlend-v2-utils';

// Define market parameters (Required for V2 interactions)
const marketParams = {
  borrowAddress: "TLoanTokenAddress...",
  collateralAddress: "TCollateralAddress...",
  oracle: "TOracleAddress...",
  irm: "TIRMAddress...",
  lltv: "0.8" // Liquidation LTV as a human-readable ratio (e.g. 0.8 = 80%).
              // Pass the plain ratio — the library scales it by 1e18 internally.
              // Must exactly match the market's on-chain lltv, or the market id won't resolve.
};

const tx = await supplyCollateral(
  marketParams,
  "50", // amount
  18,   // decimals
  "TMoolahContractAddress...", // JustLend Moolah contract
  "TUserAddress..."    // User address
);

```

**Liquidate an Unhealthy Position**

```javascript
import { getLoanTokenAmountNeed, liquidate, approve, getAllowance, Config } from 'justlend-v2-utils';

const marketId = '0x...'; // bytes32 — fetched from Moolah `getId(marketParams)`
const borrower = 'TBorrowerAddress...';
const seizedAssets = '50';   // collateral to seize (human-readable)
const decimals = 18;

// 1. Preview how many loan tokens you need to repay
const need = await getLoanTokenAmountNeed(marketId, seizedAssets, null, decimals);
console.log('Loan tokens required:', need.toString());

// 2. Approve the PublicLiquidator on the loan token if needed
const liquidatorAddr = Config.contracts.main.PublicLiquidatorProxy;
const allowance = await getAllowance(loanTokenAddr, userAddr, liquidatorAddr);
if (allowance.lt(need)) {
  await approve(loanTokenAddr, liquidatorAddr);
}

// 3. Execute the liquidation
const tx = await liquidate(marketId, borrower, seizedAssets, null, decimals);
console.log('TxID:', tx.transaction.txID);

// Alternatively, liquidate by repaidShares — pass shares as the 4th arg, set seizedAssets to 0:
// await liquidate(marketId, borrower, 0, '500000000', 6);
```

**Wrap TRX ↔ WTRX**

```javascript
import { depositTrxToWtrx, withdrawTrxFromWtrx } from 'justlend-v2-utils';

// Wrap 100 TRX into WTRX. Defaults to the network's WtrxContractProxy from config.
await depositTrxToWtrx(100);

// Unwrap 100 WTRX back into native TRX through WtrxContractProxy.withdraw().
await withdrawTrxFromWtrx(100);
```

**Claim V2 Mining Rewards**

```javascript
import { getMerkleRoot, isClaimed, multiClaim, Config } from 'justlend-v2-utils';

// Round/proof data is supplied by the JustLend backend
const periods = [
  {
    merkleIndex: '12',
    index: '345',
    amount: '1000000',          // single-token: a string
    merkleProof: ['0xabc...', '0xdef...'],
  },
];

// 1. (Optional) Pre-check: skip rounds whose merkle root isn't on-chain yet
//    or that the user has already claimed.
const claimable = [];
for (const p of periods) {
  const root = await getMerkleRoot(p.merkleIndex);
  if (!root) continue;
  if (await isClaimed(p.merkleIndex, p.index)) continue;
  claimable.push(p);
}

// 2. Batch claim against the default MerkleDistributor (single-token signature)
const tx = await multiClaim(claimable);
console.log('TxID:', tx.transaction.txID);

// 3. NEW USDD multi-token variant — pass the multi-token contract address
//    and use an array for `amount` to switch the function signature automatically.
const newUsddAddr = Config.contracts.main.MerkleDistributorNEWUSDD;
await multiClaim(
  [{ ...periods[0], amount: ['1000000', '500000'] }],
  newUsddAddr,
);
```

### 3. Helpers

```javascript
import { formatNumber, toChainAmount } from 'justlend-v2-utils';

console.log(formatNumber("123456.789", 2)); // Output: "123,456.78"
const raw = toChainAmount("1", 6); // Output: "1000000"

```

## API Overview

All main methods are exported from `systemV2.js`:

| Method Name | Description |
| --- | --- |
| `depositToVault` | Deposit assets into a Vault |
| `redeemFromVault` | Redeem assets from a Vault |
| `supplyCollateral` | Supply assets as collateral |
| `withdrawCollateral` | Withdraw collateral |
| `borrow` | Borrow assets |
| `repay` | Repay a loan |
| `depositTrxToVault` | Deposit native TRX |
| `borrowTrx` | Borrow native TRX |
| `depositTrxToWtrx` | Wrap native TRX into WTRX via `WtrxContractProxy.deposit()` |
| `withdrawTrxFromWtrx` | Unwrap WTRX into native TRX via `WtrxContractProxy.withdraw()` |
| `getLoanTokenAmountNeed` | View — preview how many loan tokens are required to seize a given amount of collateral (or to cover a given amount of borrow shares) |
| `liquidate` | Liquidate an unhealthy position via `PublicLiquidatorProxy` (by `seizedAssets` or by `repaidShares`) |
| `getMerkleRoot` | View — read the on-chain Merkle root for a mining round (returns `null` if not yet published) |
| `isClaimed` | View — check whether a `(merkleIndex, index)` pair has already been claimed |
| `multiClaim` | Batch-claim V2 mining rewards across rounds; auto-selects the multi-token signature when `amount` is an array |

*Note: Methods involving lending usually require a `marketParams` object containing contract addresses for the Oracle, IRM, etc. The mining-reward methods target the `MerkleDistributor` (single-token) or `MerkleDistributorNEWUSDD` (multi-token) contracts configured per network in `src/config.js`.*

## Development

If you want to contribute or run the example app locally.

**Prerequisites**

* Node.js
* TronLink Wallet Extension (for frontend interaction)

**Installation & Running**
This project uses Vite for building and development.

1. **Install Dependencies**:

```bash
pnpm install

```

2. **Start Development Server (Example App)**:

```bash
pnpm dev

```

3. **Build Library**:

```bash
pnpm build

```

4. **Run Tests**:

```bash
pnpm test

```

(Tests use the Vitest framework)

## Project Structure

* **`utils/blockchain.js`**: Core TronWeb instance wrapper, handling transaction triggering, signing, and broadcasting.
* **`utils/systemV2.js`**: Business logic layer containing all core contract method wrappers for JustLend V2.
* **`utils/helper.js`**: Utilities for number conversion, formatting, and BigNumber configuration.
* **`config.js`**: Keyless read-only network configuration (defaults to TRON Mainnet) and trusted RPC-host validation.
* **`Example.jsx`**: React component example demonstrating how to connect a wallet and call contracts.

## Configuration

The configuration file is located at `src/config.js`. Its **keyless, read-only fallback client** connects to **TRON Mainnet** through `https://api.trongrid.io`. This default cannot sign transactions. Write operations require an explicitly injected browser or Node.js TronWeb instance plus a sender address.

Set `JUSTLEND_FULLHOST=https://nile.trongrid.io` to use Nile for the fallback client in Node.js. The built-in configuration accepts HTTPS TronGrid endpoints and loopback development URLs. For an operator-controlled custom node, also set `JUSTLEND_ALLOW_UNTRUSTED_FULLHOST=true` explicitly.

```javascript
const Config = {
  chain: {
    // No private key is configured for the fallback client.
    fullHost: 'https://api.trongrid.io'
  },
  feeLimit: 200000000,
  trxPrecision: 1e6,
  contracts: {
    main: {
      MoolahProxy: 'TRpY4gn6hHxA8x6oMtb3v3A37edkmaeY8j',
      TrxProviderProxy: 'TGBHLgstjZQCRVNx3UZTD3UaQaWYxa4nM6',
      MerkleDistributor: 'TQoiXqruw4SqYPwHAd6QiNZ3ES4rLsejAj',           // V2 mining (single-token)
      MerkleDistributorNEWUSDD: 'TYxJzmeDyxuxFbaGywjivfkft75qLeS485',    // V2 mining (multi-token / NEW USDD)
      PublicLiquidatorProxy: 'TGDuQaHtvadVL5z9PMM874CaehQnwf3qJi',       // Liquidation entry point
      WtrxContractProxy: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR',           // WTRX wrapper
    },
    nile: {
      MoolahProxy: 'TFgrgsd8c37ByaZx1YxpBzazJS8bHsoP5c',
      TrxProviderProxy: 'TMRZwenUVHPvnxhwDDQLY4SEmmwXvtKRjz',
      MerkleDistributor: 'TKQ5VVJPsoZDD7NqQ8ffhFwzeRp45XLSGt',
      PublicLiquidatorProxy: 'TLvPrXHVQCA54gLQjLfoNi5XQ6WqhXCEps',
      WtrxContractProxy: 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a',
    },
  },
}

```

## License

This project is licensed under the **Apache License 2.0**.
See the [LICENSE](./LICENSE) file for the full license text.
