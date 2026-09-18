import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TronWeb } from 'tronweb';
import Config from '../config';
import * as system from '../utils/systemV2';
import * as blockchain from '../utils/blockchain';

// Mainnet deployments verified against the live App and read-only chain data
// on 2026-09-18. Keep these expectations independent of the SDK registry.
const MOOLAH = 'TDH4dhmVQQNc1ZNudJwWzBcs2h6ahhWrpp';
const PROVIDER = 'TMDENHFSiRzmJNSEBAFmrDbLkQ672iPN8H';
const VAULT = 'THpxp8RpCUGk55dV7oL1LfxDeP9QvouxmM';
const SINGLE = 'TQoiXqruw4SqYPwHAd6QiNZ3ES4rLsejAj';
const USDD = 'TYxJzmeDyxuxFbaGywjivfkft75qLeS485';
const MULTI = 'TUsyCPRyQdMsn9WnJcssBFXtzg6bUVbty6';
const V2_REWARDS = 'TRiE1tGxBitNAMUazZ6Kk7GA36hpPdzUSL';
const ACCOUNT = 'TKGRE6oiU3rEzasue4MsB6sCXXSTx9BAe3';
const MARKET = {
  borrowAddress: 'TPYwAC9Y4uUcT2QH3WPPjqxzJSJWymMoMS',
  collateralAddress: 'TW714k8Ni3g7yiHUUckXXuSdCPqFmNXZis',
  oracle: 'TFYLvDFSEW6dKSnWb3mt76hkHAgxPktrnG',
  irm: 'TQYeFiTVNfJ6jfqjyfL2s93VLG1huaMEzC',
  lltv: '0.9',
};
const claim = (amount) => ({
  merkleIndex: '12', index: '345', amount, merkleProof: [`0x${'ab'.repeat(32)}`],
});
const singleSelector = 'multiClaim((uint256,uint256,uint256,bytes32[])[])';
const multiSelector = 'multiClaim((uint256,uint256,uint256[],bytes32[])[])';
let previousNetwork;

beforeEach(() => {
  previousNetwork = blockchain.tronObj.network;
  blockchain.tronObj.network = 'main';
  // Never sign, broadcast, estimate on-chain, or depend on a funded account.
  vi.spyOn(blockchain, 'triggerV2').mockResolvedValue({ transaction: { txID: 'mock' } });
  vi.spyOn(blockchain, 'triggerEnergy').mockResolvedValue({ energy_used: 31000 });
});

afterEach(() => {
  blockchain.tronObj.network = previousNetwork;
  vi.restoreAllMocks();
});

describe('current V2 deployment routing', () => {
  it.each([
    ['MoolahProxy', MOOLAH], ['TrxProviderProxy', PROVIDER],
    ['MerkleDistributor', SINGLE], ['MerkleDistributorNEWUSDD', USDD],
    ['MultiMerkleDistributor', MULTI], ['MerkleDistributorV2', V2_REWARDS],
  ])('resolves mainnet %s', (key, address) => {
    expect(system.getContractsAddress(key)).toBe(address);
  });

  const writes = [
    ['supplyCollateral', [MARKET, '1', 6, ACCOUNT], MOOLAH],
    ['withdrawCollateral', [MARKET, '1', 6, ACCOUNT, ACCOUNT], MOOLAH],
    ['borrow', [MARKET, '1', 6, ACCOUNT, ACCOUNT], MOOLAH],
    ['repay', [MARKET, '1', 6, null, ACCOUNT], MOOLAH],
    ['depositTrxToVault', [VAULT, ACCOUNT, '1'], PROVIDER],
    ['redeemTrxFromVault', [VAULT, '1', 6, null, ACCOUNT, ACCOUNT], PROVIDER],
    ['supplyTrxAsCollateral', [MARKET, ACCOUNT, '1'], PROVIDER],
    ['borrowTrx', [MARKET, '1', ACCOUNT, ACCOUNT], PROVIDER],
    ['repayWithTrx', [MARKET, '1', null, ACCOUNT, null], PROVIDER],
    ['withdrawTrxCollateral', [MARKET, '1', ACCOUNT, ACCOUNT], PROVIDER],
  ];

  it.each(writes)('%s uses the current proxy when omitted', async (name, args, address) => {
    await system[name](...args);
    expect(blockchain.triggerV2).toHaveBeenCalledExactlyOnceWith(
      address, expect.any(String), expect.any(Array), expect.any(Object),
    );
  });

  it.each(writes)('%s preserves an explicit legacy proxy override', async (name, args, address) => {
    const legacy = address === MOOLAH
      ? 'TRpY4gn6hHxA8x6oMtb3v3A37edkmaeY8j'
      : 'TGBHLgstjZQCRVNx3UZTD3UaQaWYxa4nM6';
    await system[name](...args, legacy, { feeLimit: 100000000 });
    expect(blockchain.triggerV2).toHaveBeenCalledExactlyOnceWith(
      legacy, expect.any(String), expect.any(Array), expect.objectContaining({ feeLimit: 100000000 }),
    );
  });

  it('estimates TRX deposits against the same current provider', async () => {
    await expect(system.estimateSupplyTrxGas(VAULT, '1', ACCOUNT)).resolves.toBe(31000);
    expect(blockchain.triggerEnergy).toHaveBeenCalledExactlyOnceWith(
      PROVIDER, 'deposit(address,address)', expect.any(Array),
      expect.objectContaining({ callValue: '1000000', _isConstant: true }),
    );
    expect(blockchain.triggerV2).not.toHaveBeenCalled();
  });

  it('keeps Nile lending addresses and fails closed for unconfigured reward deployments', () => {
    blockchain.tronObj.network = 'nile';
    expect(Config.contracts.nile).toEqual({
      MoolahProxy: 'TFgrgsd8c37ByaZx1YxpBzazJS8bHsoP5c',
      TrxProviderProxy: 'TMRZwenUVHPvnxhwDDQLY4SEmmwXvtKRjz',
      PublicLiquidatorProxy: 'TLvPrXHVQCA54gLQjLfoNi5XQ6WqhXCEps',
      WtrxContractProxy: 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a',
    });
    for (const key of ['MerkleDistributor', 'MerkleDistributorNEWUSDD', 'MultiMerkleDistributor', 'MerkleDistributorV2']) {
      expect(() => system.getContractsAddress(key)).toThrow(`No ${key} contract is configured for TRON network "nile"`);
    }
  });
});

describe('reward distributor ABI compatibility', () => {
  it('retains the existing single-token default', async () => {
    await system.multiClaim([claim('1000000')]);
    expect(blockchain.triggerV2).toHaveBeenCalledExactlyOnceWith(
      SINGLE, singleSelector, expect.any(Array), {},
    );
  });

  it('keeps NEWUSDD single-token, not multi-token', async () => {
    await system.multiClaim([claim('1000000')], USDD);
    expect(blockchain.triggerV2).toHaveBeenCalledExactlyOnceWith(
      USDD, singleSelector, expect.any(Array), {},
    );
  });

  it.each([MULTI, V2_REWARDS])('preserves multi-token order and zero slots at %s', async (address) => {
    const claims = [claim(['0', '1000000', '0']), { ...claim(['2000000', '0', '3']), merkleIndex: '13' }];
    const original = structuredClone(claims);
    await system.multiClaim(claims, address, { feeLimit: 100000000 });
    expect(claims).toEqual(original);
    expect(blockchain.triggerV2).toHaveBeenCalledExactlyOnceWith(
      address, multiSelector,
      [{ type: '(uint256,uint256,uint256[],bytes32[])[]', value: original.map(c => [c.merkleIndex, c.index, c.amount, c.merkleProof]) }],
      { feeLimit: 100000000 },
    );
  });

  it.each([
    ['default single-token', undefined, ['1']],
    ['legacy single-token', SINGLE, ['1']],
    ['NEWUSDD single-token', USDD, ['1']],
    ['general multi-token', MULTI, '1'],
    ['V2 multi-token', V2_REWARDS, '1'],
    ['hex single-token', TronWeb.address.toHex(USDD).toUpperCase(), ['1']],
    ['hex multi-token', TronWeb.address.toHex(V2_REWARDS), '1'],
  ])('rejects a mismatched ABI for %s before transaction construction', async (_, address, amount) => {
    await expect(system.multiClaim([claim(amount)], address)).rejects.toThrow(/requires .*amount/);
    expect(blockchain.triggerV2).not.toHaveBeenCalled();
  });

  it.each([
    ['empty batch', []], ['missing batch', undefined], ['non-array batch', {}],
    ['missing claim', [null]], ['missing amount', [claim(undefined)]],
    ['null amount', [claim(null)]], ['empty amounts', [claim([])]],
    ['scalar then array', [claim('1'), claim(['2'])]],
    ['array then scalar', [claim(['1']), claim('2')]],
  ])('rejects %s before transaction construction', async (_, claims) => {
    await expect(system.multiClaim(claims, ACCOUNT)).rejects.toThrow(/claims|amount/);
    expect(blockchain.triggerV2).not.toHaveBeenCalled();
  });

  it.each([['1', singleSelector], [['0', '1'], multiSelector]])(
    'preserves shape-based encoding for an explicit custom distributor (%j)', async (amount, selector) => {
      await system.multiClaim([claim(amount)], ACCOUNT);
      expect(blockchain.triggerV2).toHaveBeenCalledExactlyOnceWith(
        ACCOUNT, selector, expect.any(Array), {},
      );
    },
  );
});
