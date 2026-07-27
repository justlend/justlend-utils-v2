import { describe, expect, it, vi } from 'vitest';
import {
  createEnergyPurchaseClient,
  EnergyPurchaseError,
  ENERGY_PURCHASE_PATHS
} from '../utils/energyPurchase';

const PAYER = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const RECEIVER = 'TVjsyZ7fYF3qLF6BQgPmTEZy1xrNNyVAAA';
const PAY_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  };
}

function envelope(data) {
  return response({ code: '0', msg: 'ok', data });
}

function config() {
  return {
    min_energy: 65000,
    max_energy: 5000000,
    max_receivers: 50,
    durations: ['1h'],
    presets: [65000, 131000],
    activation_fee_sun: 1100000,
    resource_pool_addresses: []
  };
}

function quote() {
  return {
    amount_sun: 2405000,
    pay_address: PAY_ADDRESS,
    can_fulfill: true,
    items: [{ receive_address: RECEIVER, needs_activation: false, activation_fee_sun: 0 }]
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function signingHarness() {
  const unsigned = {
    txID: 'unsigned-id',
    raw_data: { expiration: 1000, contract: [{ type: 'TransferContract' }] },
    raw_data_hex: '00'
  };
  const extended = { ...unsigned, txID: 'signed-id', raw_data: { ...unsigned.raw_data, expiration: 300001 } };
  const tronWeb = {
    transactionBuilder: {
      sendTrx: vi.fn(async () => unsigned),
      extendExpiration: vi.fn(async () => extended)
    },
    trx: { getTransaction: vi.fn(async () => null) }
  };
  const signTransaction = vi.fn(async transaction => ({ ...transaction, signature: ['aa'] }));
  return { tronWeb, signTransaction };
}

describe('energy purchase client', () => {
  it('requires an explicit HTTPS API URL and has no production fallback', () => {
    expect(() => createEnergyPurchaseClient()).toThrowError(EnergyPurchaseError);
    expect(() => createEnergyPurchaseClient({ baseUrl: 'http://example.com' })).toThrow(/HTTPS/);
  });

  it('validates quote inputs against live limits before requesting a quote', async () => {
    const fetch = vi.fn(async url => {
      if (url.endsWith(ENERGY_PURCHASE_PATHS.config)) return envelope(config());
      throw new Error(`unexpected ${url}`);
    });
    const client = createEnergyPurchaseClient({ baseUrl: 'https://energy.example.com', fetch });

    await expect(client.quote({ receivers: [RECEIVER], energyPerReceiver: 1 })).rejects.toMatchObject({
      code: 'INVALID_AMOUNT'
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('builds and signs a payment without broadcasting it', async () => {
    const { tronWeb, signTransaction } = signingHarness();
    const client = createEnergyPurchaseClient({
      baseUrl: 'https://energy.example.com',
      fetch: vi.fn(),
      tronWeb,
      now: () => 1
    });

    const signed = await client.buildAndSignPayment({
      payerAddress: PAYER,
      payAddress: PAY_ADDRESS,
      amountSun: 2405000,
      signTransaction
    });

    expect(signed.txID).toBe('signed-id');
    expect(tronWeb.transactionBuilder.sendTrx).toHaveBeenCalledWith(PAY_ADDRESS, 2405000, PAYER);
    expect(tronWeb.transactionBuilder.extendExpiration).toHaveBeenCalled();
    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(tronWeb.trx.getTransaction).not.toHaveBeenCalled();
  });

  it('retries only the same signed transaction and polls an accepted order', async () => {
    const { tronWeb, signTransaction } = signingHarness();
    let buyCalls = 0;
    const submitted = [];
    const fetch = vi.fn(async (url, options) => {
      if (url.endsWith(ENERGY_PURCHASE_PATHS.config)) return envelope(config());
      if (url.endsWith(ENERGY_PURCHASE_PATHS.quote)) return envelope(quote());
      if (url.endsWith(ENERGY_PURCHASE_PATHS.buy)) {
        submitted.push(JSON.parse(options.body).signed_transaction.txID);
        buyCalls += 1;
        if (buyCalls === 1) throw new Error('connection reset');
        return envelope({ id: 7, tx_id: 'signed-id', access_token: 'token', state: 'paid' });
      }
      if (url.endsWith('/v1/consumer/energy/orders/7')) return envelope({ id: 7, state: 'delivered' });
      throw new Error(`unexpected ${url}`);
    });
    const client = createEnergyPurchaseClient({
      baseUrl: 'https://energy.example.com',
      fetch,
      tronWeb,
      storage: memoryStorage(),
      sleep: async () => {},
      now: () => 1
    });

    const result = await client.purchase({
      payerAddress: PAYER,
      receivers: [RECEIVER],
      energyPerReceiver: 65000,
      duration: '1h',
      expectedAmountSun: 2405000,
      signTransaction
    });

    expect(result).toMatchObject({ ok: true, orderId: 7, txHash: 'signed-id', state: 'delivered' });
    expect(submitted).toEqual(['signed-id', 'signed-id']);
    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(client.getPaymentRisk(PAYER)).toBeNull();
  });

  it('stops retrying on a structured business error and clears the provisional risk', async () => {
    const { tronWeb, signTransaction } = signingHarness();
    const storage = memoryStorage();
    const fetch = vi.fn(async url => {
      if (url.endsWith(ENERGY_PURCHASE_PATHS.config)) return envelope(config());
      if (url.endsWith(ENERGY_PURCHASE_PATHS.quote)) return envelope(quote());
      if (url.endsWith(ENERGY_PURCHASE_PATHS.buy)) {
        return response({ code: 'price_moved', msg: 'price changed', data: null }, 409);
      }
      throw new Error(`unexpected ${url}`);
    });
    const client = createEnergyPurchaseClient({
      baseUrl: 'https://energy.example.com',
      fetch,
      tronWeb,
      storage,
      sleep: async () => {},
      now: () => 1
    });

    await expect(
      client.purchase({
        payerAddress: PAYER,
        receivers: [RECEIVER],
        energyPerReceiver: 65000,
        duration: '1h',
        signTransaction
      })
    ).rejects.toMatchObject({ code: 'PRICE_MOVED', isBusinessError: true });
    expect(fetch.mock.calls.filter(([url]) => url.endsWith(ENERGY_PURCHASE_PATHS.buy))).toHaveLength(1);
    expect(client.getPaymentRisk(PAYER)).toBeNull();
  });

  it('retains an expired risk when chain lookup is unavailable', async () => {
    const { tronWeb } = signingHarness();
    tronWeb.trx.getTransaction.mockRejectedValue(new Error('network unavailable'));
    const storage = memoryStorage();
    const client = createEnergyPurchaseClient({
      baseUrl: 'https://energy.example.com',
      fetch: vi.fn(),
      tronWeb,
      storage,
      now: () => 10
    });
    storage.setItem(
      `justlend_energy_purchase_risk:${encodeURIComponent(PAYER)}`,
      JSON.stringify([{ payerAddress: PAYER, signedTxId: 'unknown', createdAt: 1, expiresAt: 2, paymentConfirmed: false }])
    );

    await expect(client.reconcilePaymentRisks(PAYER)).resolves.toHaveLength(1);
  });
});
