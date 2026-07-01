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
const Config = {
  chain: {
    // Placeholder key (private key = 1) used ONLY to construct the default
    // read-only TronWeb instance for `view()` calls. Real signing happens via
    // the injected `tronObj.tronWeb` (browser wallet / Node key) — this value
    // never holds funds and is not a secret. Do NOT replace it with a real key.
    privateKey: '01',
    // Default the read-only TronWeb instance to MAINNET. Override per-deploy via
    // the JUSTLEND_FULLHOST env var (Node), or by injecting `tronObj.tronWeb`
    // (browser wallet / custom node). `process` is guarded so this stays safe in
    // the browser bundle. For testnet use e.g. JUSTLEND_FULLHOST=https://nile.trongrid.io
    fullHost:
      (typeof process !== 'undefined' &&
        process.env &&
        process.env.JUSTLEND_FULLHOST) ||
      'https://api.trongrid.io',
  },
  feeLimit: 200000000,
  trxPrecision: 1e6,
  // TetherToken-class tokens whose `approve` REVERTs on a non-zero→non-zero
  // change (require approve(0) first). Addresses are globally unique, so this is
  // a flat allowlist checked across networks. Consumers can extend it at runtime.
  resetToZeroTokens: [
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // mainnet USDT (TetherToken)
    'TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT', // mainnet USDJ (TetherToken-derived)
  ],
  contracts: {
   main:{
     MoolahProxy: 'TRpY4gn6hHxA8x6oMtb3v3A37edkmaeY8j',
     TrxProviderProxy: 'TGBHLgstjZQCRVNx3UZTD3UaQaWYxa4nM6',
     MerkleDistributor: 'TQoiXqruw4SqYPwHAd6QiNZ3ES4rLsejAj',
     MerkleDistributorNEWUSDD: 'TYxJzmeDyxuxFbaGywjivfkft75qLeS485',
     PublicLiquidatorProxy: 'TGDuQaHtvadVL5z9PMM874CaehQnwf3qJi',
     WtrxContractProxy: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR',
   },
   nile:{
     MoolahProxy: 'TFgrgsd8c37ByaZx1YxpBzazJS8bHsoP5c',
     TrxProviderProxy: 'TMRZwenUVHPvnxhwDDQLY4SEmmwXvtKRjz',
     MerkleDistributor: 'TKQ5VVJPsoZDD7NqQ8ffhFwzeRp45XLSGt',
     PublicLiquidatorProxy: 'TLvPrXHVQCA54gLQjLfoNi5XQ6WqhXCEps',
     WtrxContractProxy: 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a',
   }
  },
}

export default Config;