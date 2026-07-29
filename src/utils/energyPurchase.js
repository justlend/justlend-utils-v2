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

import { TronWeb } from 'tronweb';

export const ENERGY_PURCHASE_PATHS = Object.freeze({
  config: '/v1/config',
  currentPrice: '/v1/price/current',
  poolHealth: '/v1/pool/health',
  quote: '/v1/price',
  buy: '/v1/consumer/energy/buy',
  order: id => `/v1/consumer/energy/orders/${encodeURIComponent(String(id))}`,
  history: '/v1/consumer/energy/orders/history'
});

export const ENERGY_PURCHASE_TERMINAL_STATES = Object.freeze([
  'delivered',
  'partial',
  'failed',
  'expired',
  'cancelled'
]);

const PAYMENT_RISK_PREFIX = 'justlend_energy_purchase_risk:';
const PAYMENT_LOCK_PREFIX = 'justlend_energy_purchase_lock:';
const DEFAULT_ORDER_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PAYMENT_RETRY_MS = 2 * 60 * 1000;
const DEFAULT_PURCHASE_INTENT_TTL_MS = 30 * 60 * 1000;
const activePayerPurchases = new Set();

export class EnergyPurchaseError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = 'EnergyPurchaseError';
    this.code = code;
    this.status = options.status;
    this.isBusinessError = options.isBusinessError === true;
    this.retryable = options.retryable === true;
    this.details = options.details;
    this.paymentRisk = options.paymentRisk;
    this.cause = options.cause;
  }
}

const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeBaseUrl(baseUrl, allowInsecureLocalhost) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new EnergyPurchaseError(
      'CONFIG_MISSING',
      'Energy purchase API baseUrl is required; this library intentionally has no production fallback.'
    );
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (cause) {
    throw new EnergyPurchaseError('CONFIG_INVALID', 'Energy purchase API baseUrl must be a valid URL.', { cause });
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(allowInsecureLocalhost === true && local && parsed.protocol === 'http:')) {
    throw new EnergyPurchaseError(
      'CONFIG_INVALID',
      'Energy purchase API baseUrl must use HTTPS; HTTP is allowed only for localhost with allowInsecureLocalhost.'
    );
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function validateAddress(address, label) {
  const isBase58 = typeof address === 'string' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (!isBase58 || !TronWeb.isAddress(address)) {
    throw new EnergyPurchaseError('INVALID_ADDRESS', `${label} must be a Base58Check TRON address.`);
  }
}

function validatePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EnergyPurchaseError('INVALID_AMOUNT', `${label} must be a positive safe integer.`);
  }
}

function validateQuoteInput(input, config) {
  const receivers = input?.receivers;
  if (!Array.isArray(receivers) || receivers.length === 0) {
    throw new EnergyPurchaseError('EMPTY_RECEIVERS', 'At least one energy receiver is required.');
  }
  receivers.forEach((address, index) => validateAddress(address, `receivers[${index}]`));
  validatePositiveInteger(input.energyPerReceiver, 'energyPerReceiver');

  if (!config || typeof config !== 'object') {
    throw new EnergyPurchaseError('INVALID_RESPONSE', 'Energy purchase configuration is unavailable.');
  }
  const min = Number(config.min_energy);
  const max = Number(config.max_energy);
  const maxReceivers = Number(config.max_receivers);
  if (![min, max, maxReceivers].every(Number.isSafeInteger) || min <= 0 || max < min || maxReceivers <= 0) {
    throw new EnergyPurchaseError('INVALID_RESPONSE', 'Energy purchase limits returned by the API are invalid.');
  }
  if (input.energyPerReceiver < min || input.energyPerReceiver > max) {
    throw new EnergyPurchaseError('INVALID_AMOUNT', `energyPerReceiver must be between ${min} and ${max}.`);
  }
  if (receivers.length > maxReceivers) {
    throw new EnergyPurchaseError('ADDR_OVERFLOW', `A maximum of ${maxReceivers} receivers is allowed.`);
  }
  const resourcePools = new Set(Array.isArray(config.resource_pool_addresses) ? config.resource_pool_addresses : []);
  if (receivers.some(address => resourcePools.has(address))) {
    throw new EnergyPurchaseError('INVALID_RECEIVERS', 'Resource-pool addresses cannot receive purchased energy.');
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function defaultPaymentLock() {
  try {
    const locks = globalThis.navigator?.locks;
    if (typeof locks?.request !== 'function') return null;
    return {
      tryRunExclusive: (key, task) =>
        locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
          if (!lock) {
            throw new EnergyPurchaseError(
              'PURCHASE_IN_PROGRESS',
              'Another energy purchase is already in progress for this payer.'
            );
          }
          return task();
        })
    };
  } catch {
    return null;
  }
}

function requireRiskStorage(storage) {
  if (
    !storage ||
    typeof storage.getItem !== 'function' ||
    typeof storage.setItem !== 'function' ||
    typeof storage.removeItem !== 'function'
  ) {
    throw new EnergyPurchaseError(
      'RISK_STORE_UNAVAILABLE',
      'Energy purchase requires durable risk storage; provide a storage adapter in Node.js.'
    );
  }
  return storage;
}

function riskStoreError(message, cause) {
  return new EnergyPurchaseError('RISK_STORE_UNAVAILABLE', message, { cause });
}

function assertRiskRecord(risk, payerAddress) {
  const validIdentity =
    (typeof risk?.intentId === 'string' && risk.intentId.length > 0) ||
    (typeof risk?.signedTxId === 'string' && risk.signedTxId.length > 0);
  if (
    !risk ||
    typeof risk !== 'object' ||
    Array.isArray(risk) ||
    risk.payerAddress !== payerAddress ||
    !validIdentity ||
    !Number.isFinite(risk.createdAt) ||
    !Number.isFinite(risk.expiresAt) ||
    typeof risk.paymentConfirmed !== 'boolean' ||
    (risk.state !== undefined && !['preparing', 'signed'].includes(risk.state))
  ) {
    throw riskStoreError('Energy payment risk storage contains an invalid record.');
  }
  return risk;
}

function createIntentId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Fail closed below instead of using Math.random for a payment intent key.
  }
  throw new EnergyPurchaseError('CONFIG_MISSING', 'A cryptographically secure random source is required.');
}

function riskKey(payerAddress) {
  return `${PAYMENT_RISK_PREFIX}${encodeURIComponent(payerAddress)}`;
}

function readRisks(storage, payerAddress) {
  requireRiskStorage(storage);
  let raw;
  try {
    raw = storage.getItem(riskKey(payerAddress));
  } catch (cause) {
    throw riskStoreError('Energy payment risk storage could not be read.', cause);
  }
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw);
    const risks = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : null;
    if (!risks) throw new Error('expected an array or object');
    return risks.map(risk => assertRiskRecord(risk, payerAddress));
  } catch (cause) {
    if (cause instanceof EnergyPurchaseError) throw cause;
    throw riskStoreError('Energy payment risk storage is corrupt or has an invalid schema.', cause);
  }
}

function writeRisk(storage, risk) {
  requireRiskStorage(storage);
  assertRiskRecord(risk, risk.payerAddress);
  const risks = readRisks(storage, risk.payerAddress);
  const sameRisk = item =>
    (risk.intentId && item.intentId === risk.intentId) ||
    (risk.signedTxId && item.signedTxId === risk.signedTxId);
  const next = risks.filter(item => !sameRisk(item));
  next.push(risk);
  try {
    storage.setItem(riskKey(risk.payerAddress), JSON.stringify(next));
  } catch (cause) {
    throw riskStoreError('Energy payment risk storage could not be written.', cause);
  }
  return risk;
}

function clearRisk(storage, payerAddress, riskId) {
  requireRiskStorage(storage);
  try {
    if (!riskId) {
      storage.removeItem(riskKey(payerAddress));
      return;
    }
    const remaining = readRisks(storage, payerAddress).filter(
      risk => risk.signedTxId !== riskId && risk.intentId !== riskId
    );
    if (remaining.length) storage.setItem(riskKey(payerAddress), JSON.stringify(remaining));
    else storage.removeItem(riskKey(payerAddress));
  } catch (cause) {
    if (cause instanceof EnergyPurchaseError) throw cause;
    throw riskStoreError('Energy payment risk storage could not be updated.', cause);
  }
}

function readRisk(storage, payerAddress) {
  const risks = readRisks(storage, payerAddress);
  return risks.find(risk => risk.paymentConfirmed === true) || risks[0] || null;
}

async function withPayerPurchaseLock(payerAddress, paymentLock, task) {
  if (activePayerPurchases.has(payerAddress)) {
    throw new EnergyPurchaseError(
      'PURCHASE_IN_PROGRESS',
      'Another energy purchase is already in progress for this payer.'
    );
  }
  if (!paymentLock || typeof paymentLock.tryRunExclusive !== 'function') {
    throw new EnergyPurchaseError(
      'PAYMENT_LOCK_UNAVAILABLE',
      'Energy purchase requires a non-waiting cross-context payment lock. Use Web Locks or provide paymentLock.tryRunExclusive().'
    );
  }
  activePayerPurchases.add(payerAddress);
  try {
    let entered = false;
    const result = await paymentLock.tryRunExclusive(`${PAYMENT_LOCK_PREFIX}${payerAddress}`, async () => {
      entered = true;
      return task();
    });
    if (!entered) {
      throw new EnergyPurchaseError(
        'PURCHASE_IN_PROGRESS',
        'Another energy purchase is already in progress for this payer.'
      );
    }
    return result;
  } catch (cause) {
    if (cause instanceof EnergyPurchaseError) throw cause;
    throw new EnergyPurchaseError('PAYMENT_LOCK_FAILED', 'The payer payment lock failed.', { cause });
  } finally {
    activePayerPurchases.delete(payerAddress);
  }
}

function normalizeSignedTransaction(signedTransaction) {
  const signed = signedTransaction?.signedTransaction || signedTransaction;
  if (
    !signed ||
    typeof signed !== 'object' ||
    typeof signed.txID !== 'string' ||
    !signed.raw_data ||
    !Array.isArray(signed.signature) ||
    signed.signature.length !== 1
  ) {
    throw new EnergyPurchaseError(
      'INVALID_SIGNED_TX',
      'Signer must return one signed TRX TransferContract transaction with txID, raw_data, and one signature.'
    );
  }
  return signed;
}

function createAbortSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  };
}

/**
 * Create a fail-closed client for the JustLend energy direct-purchase API.
 * The API URL is always explicit and payment transactions are signed locally but never broadcast by this client.
 */
export function createEnergyPurchaseClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl, options.allowInsecureLocalhost);
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new EnergyPurchaseError('CONFIG_MISSING', 'A Fetch-compatible implementation is required.');
  }
  const tronWeb = options.tronWeb;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const paymentLock = options.paymentLock ||
    (typeof storage?.tryRunExclusive === 'function' ? storage : defaultPaymentLock());
  const requestTimeoutMs = options.requestTimeoutMs ?? 8000;
  const paymentRetryIntervalMs = options.paymentRetryIntervalMs ?? 5000;
  const paymentRetryTimeoutMs = options.paymentRetryTimeoutMs ?? DEFAULT_PAYMENT_RETRY_MS;
  const orderPollIntervalMs = options.orderPollIntervalMs ?? 3000;
  const orderPollTimeoutMs = options.orderPollTimeoutMs ?? 150000;
  const orderTtlMs = options.orderTtlMs ?? DEFAULT_ORDER_TTL_MS;
  const sleep = options.sleep || sleepDefault;
  const now = options.now || Date.now;

  async function request(method, path, requestOptions = {}) {
    const { signal, cleanup } = createAbortSignal(requestOptions.timeoutMs ?? requestTimeoutMs, requestOptions.signal);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(requestOptions.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(requestOptions.token ? { 'X-Consumer-Order-Token': requestOptions.token } : {})
        },
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        signal
      });
    } catch (cause) {
      throw new EnergyPurchaseError('NETWORK_ERROR', 'Energy purchase API request did not return a response.', {
        retryable: true,
        cause
      });
    } finally {
      cleanup();
    }

    let envelope;
    try {
      envelope = await response.json();
    } catch (cause) {
      throw new EnergyPurchaseError('INVALID_RESPONSE', 'Energy purchase API returned a non-JSON response.', {
        status: response.status,
        retryable: response.status >= 500,
        cause
      });
    }
    if (envelope?.code !== '0') {
      const businessCode = typeof envelope?.code === 'string' && envelope.code.length > 0;
      throw new EnergyPurchaseError(businessCode ? envelope.code.toUpperCase() : 'INVALID_RESPONSE', envelope?.msg, {
        status: response.status,
        isBusinessError: businessCode,
        retryable: !businessCode && response.status >= 500
      });
    }
    if (!response.ok) {
      throw new EnergyPurchaseError('HTTP_ERROR', `Energy purchase API returned HTTP ${response.status}.`, {
        status: response.status,
        retryable: response.status >= 500
      });
    }
    return envelope.data;
  }

  const getConfig = requestOptions => request('GET', ENERGY_PURCHASE_PATHS.config, requestOptions);
  const getCurrentPrice = requestOptions => request('GET', ENERGY_PURCHASE_PATHS.currentPrice, requestOptions);
  const getPoolHealth = requestOptions => request('GET', ENERGY_PURCHASE_PATHS.poolHealth, requestOptions);

  async function quote(input, requestOptions) {
    const config = input.config || (await getConfig(requestOptions));
    validateQuoteInput(input, config);
    const result = await request('POST', ENERGY_PURCHASE_PATHS.quote, {
      ...requestOptions,
      body: { receivers: input.receivers, energy_per_receiver: input.energyPerReceiver }
    });
    if (
      !result ||
      typeof result.can_fulfill !== 'boolean' ||
      !Number.isSafeInteger(Number(result.amount_sun)) ||
      Number(result.amount_sun) <= 0 ||
      typeof result.pay_address !== 'string'
    ) {
      throw new EnergyPurchaseError('INVALID_RESPONSE', 'Energy purchase quote is missing required fields.');
    }
    if (!result.can_fulfill) {
      throw new EnergyPurchaseError('POOL_INSUFFICIENT', 'No single resource pool can fulfill this quote.', {
        isBusinessError: true,
        details: {
          maxSingleOrderEnergy: result.max_single_order_energy ?? null,
          requiredEnergy: input.energyPerReceiver * input.receivers.length
        }
      });
    }
    validateAddress(result.pay_address, 'quote pay_address');
    return result;
  }

  async function getOrder(orderId, requestOptions = {}) {
    if (orderId === undefined || orderId === null || String(orderId).length === 0) {
      throw new EnergyPurchaseError('INVALID_ORDER_ID', 'orderId is required.');
    }
    return request('GET', ENERGY_PURCHASE_PATHS.order(orderId), requestOptions);
  }

  async function getHistory(address, historyOptions = {}) {
    validateAddress(address, 'history address');
    const query = new URLSearchParams({ address });
    if (historyOptions.size !== undefined) {
      validatePositiveInteger(historyOptions.page ?? 1, 'page');
      validatePositiveInteger(historyOptions.size, 'size');
      query.set('page', String(historyOptions.page ?? 1));
      query.set('size', String(historyOptions.size));
    }
    return request('GET', `${ENERGY_PURCHASE_PATHS.history}?${query}`, historyOptions);
  }

  async function buildAndSignPayment({ payerAddress, payAddress, amountSun, signTransaction }) {
    if (!tronWeb?.transactionBuilder?.sendTrx) {
      throw new EnergyPurchaseError('CONFIG_MISSING', 'tronWeb with transactionBuilder.sendTrx is required for signing.');
    }
    if (typeof signTransaction !== 'function') {
      throw new EnergyPurchaseError('CONFIG_MISSING', 'signTransaction callback is required.');
    }
    validateAddress(payerAddress, 'payerAddress');
    validateAddress(payAddress, 'payAddress');
    validatePositiveInteger(Number(amountSun), 'amountSun');
    let unsigned = await tronWeb.transactionBuilder.sendTrx(payAddress, Number(amountSun), payerAddress);
    if (unsigned?.raw_data?.expiration && tronWeb.transactionBuilder.extendExpiration) {
      const extensionSeconds = Math.ceil((now() + orderTtlMs - Number(unsigned.raw_data.expiration)) / 1000);
      if (extensionSeconds > 0) {
        try {
          const candidate = { ...unsigned, raw_data: { ...unsigned.raw_data } };
          unsigned = await tronWeb.transactionBuilder.extendExpiration(candidate, extensionSeconds, { txLocal: true });
        } catch {
          // The node-provided expiration is a shorter, safe fallback.
        }
      }
    }
    return normalizeSignedTransaction(
      await signTransaction(unsigned, {
        description: `Pay ${Number(amountSun) / 1e6} TRX for JustLend energy. Sign only; the service broadcasts.`
      })
    );
  }

  async function lookupTransaction(txId) {
    if (!txId || typeof tronWeb?.trx?.getTransaction !== 'function') return 'unavailable';
    try {
      const transaction = await tronWeb.trx.getTransaction(txId);
      return transaction?.txID === txId ? 'found' : 'not_found';
    } catch (error) {
      return String(error?.message || error).toLowerCase().includes('transaction not found')
        ? 'not_found'
        : 'unavailable';
    }
  }

  async function reconcilePaymentRisksUnlocked(payerAddress) {
    validateAddress(payerAddress, 'payerAddress');
    const risks = readRisks(storage, payerAddress);
    let history = null;
    for (const risk of risks) {
      if (!risk.signedTxId) {
        if (now() >= risk.expiresAt) clearRisk(storage, payerAddress, risk.intentId);
        continue;
      }
      const lookup = await lookupTransaction(risk.signedTxId);
      if (lookup === 'found') {
        risk.paymentConfirmed = true;
        writeRisk(storage, risk);
        if (history === null) {
          try {
            history = await getHistory(payerAddress);
          } catch {
            history = {};
          }
        }
        const rows = Array.isArray(history?.rows) ? history.rows : [];
        if (rows.some(row => row.payment_tx_id === risk.signedTxId)) {
          clearRisk(storage, payerAddress, risk.signedTxId);
        }
      } else if (lookup === 'not_found' && now() >= risk.expiresAt) {
        clearRisk(storage, payerAddress, risk.signedTxId);
      }
    }
    return readRisks(storage, payerAddress);
  }

  async function pollOrder(orderId, pollOptions = {}) {
    const deadline = now() + (pollOptions.timeoutMs ?? orderPollTimeoutMs);
    let detail = null;
    while (now() < deadline) {
      try {
        detail = await getOrder(orderId, { token: pollOptions.token, signal: pollOptions.signal });
        pollOptions.onState?.(detail?.state, detail);
        if (ENERGY_PURCHASE_TERMINAL_STATES.includes(detail?.state)) return detail;
      } catch (error) {
        if (pollOptions.signal?.aborted) {
          throw new EnergyPurchaseError('ABORTED', 'Energy purchase order polling was aborted.', { cause: error });
        }
        // Payment is already accepted; tolerate transient order-query failures until the deadline.
      }
      await sleep(orderPollIntervalMs);
    }
    return detail;
  }

  async function purchaseLocked(input) {
    validateAddress(input.payerAddress, 'payerAddress');
    const reconciledRisks = await reconcilePaymentRisksUnlocked(input.payerAddress);
    const previousRisk = reconciledRisks.find(risk => risk.paymentConfirmed === true) || reconciledRisks[0] || null;
    if (previousRisk && input.acknowledgePreviousPaymentRisk !== true) {
      throw new EnergyPurchaseError(
        'PAYMENT_RISK_UNRESOLVED',
        'A previous payment has an unknown result. Reconcile it before signing another payment.',
        { paymentRisk: previousRisk }
      );
    }

    input.onState?.('quoting');
    const config = input.config || (await getConfig({ signal: input.signal }));
    const durations = Array.isArray(config?.durations)
      ? config.durations.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim())
      : [];
    if (typeof input.duration !== 'string' || !durations.includes(input.duration)) {
      throw new EnergyPurchaseError(
        'INVALID_DURATION',
        'duration must be explicitly selected from the live /v1/config durations list.'
      );
    }
    const authoritativeQuote = await quote({ ...input, config }, { signal: input.signal });
    if (input.expectedAmountSun === undefined) {
      throw new EnergyPurchaseError(
        'CONFIRMATION_REQUIRED',
        'expectedAmountSun is required and must match the authoritative quote exactly.'
      );
    }
    validatePositiveInteger(Number(input.expectedAmountSun), 'expectedAmountSun');
    if (Number(authoritativeQuote.amount_sun) !== Number(input.expectedAmountSun)) {
      throw new EnergyPurchaseError('AMOUNT_CHANGED', 'The authoritative quote differs from the confirmed amount.', {
        details: { amountSun: authoritativeQuote.amount_sun, expectedAmountSun: input.expectedAmountSun }
      });
    }

    // Persist an intent before asking the wallet to sign. A crash or tab/process
    // exit can therefore never turn an in-flight signing decision back into
    // "no payment risk" on restart.
    const intent = {
      payerAddress: input.payerAddress,
      intentId: createIntentId(),
      state: 'preparing',
      createdAt: now(),
      expiresAt: now() + DEFAULT_PURCHASE_INTENT_TTL_MS,
      paymentConfirmed: false
    };
    writeRisk(storage, intent);

    input.onState?.('signing');
    let signed;
    try {
      signed = await buildAndSignPayment({
        payerAddress: input.payerAddress,
        payAddress: authoritativeQuote.pay_address,
        amountSun: Number(authoritativeQuote.amount_sun),
        signTransaction: input.signTransaction
      });
    } catch (error) {
      clearRisk(storage, input.payerAddress, intent.intentId);
      throw error;
    }
    const signedExpiration = Number(signed.raw_data?.expiration);
    const signedDeadline = Number.isFinite(signedExpiration) ? signedExpiration : now() + orderTtlMs;
    const retryDeadline = Math.min(signedDeadline, now() + paymentRetryTimeoutMs);
    const risk = {
      ...intent,
      signedTxId: signed.txID,
      state: 'signed',
      expiresAt: signedDeadline,
    };
    writeRisk(storage, risk);

    input.onState?.('submitting');
    let order;
    while (!order) {
      if (input.signal?.aborted) throw new EnergyPurchaseError('ABORTED', 'Energy purchase was aborted.');
      writeRisk(storage, risk);
      try {
        order = await request('POST', ENERGY_PURCHASE_PATHS.buy, {
          body: {
            receivers: input.receivers,
            energy_per_receiver: input.energyPerReceiver,
            duration: input.duration,
            payer_address: input.payerAddress,
            signed_transaction: signed
          },
          signal: input.signal
        });
      } catch (error) {
        if (error.isBusinessError) {
          if (error.code === 'TX_ALREADY_CLAIMED') {
            risk.paymentConfirmed = true;
            writeRisk(storage, risk);
            error.paymentRisk = risk;
          } else {
            clearRisk(storage, input.payerAddress, signed.txID);
          }
          throw error;
        }
        if (now() >= retryDeadline) {
          if (await lookupTransaction(signed.txID) === 'found') {
            risk.paymentConfirmed = true;
            writeRisk(storage, risk);
            return {
              ok: true,
              orderId: null,
              txHash: signed.txID,
              state: 'pending',
              confirmedOnChain: true,
              paymentRisk: risk
            };
          }
          throw new EnergyPurchaseError(
            'PAYMENT_RESULT_UNKNOWN',
            'The same signed payment could not be reconciled; do not create another payment silently.',
            { retryable: false, paymentRisk: risk, cause: error }
          );
        }
        await sleep(paymentRetryIntervalMs);
      }
    }

    clearRisk(storage, input.payerAddress, signed.txID);
    const orderId = order.id;
    const txHash = order.tx_id || signed.txID;
    input.onOrderAccepted?.({ orderId, txHash, state: order.state || 'pending' });
    input.onState?.('delivering');
    const detail = await pollOrder(orderId, {
      token: order.access_token,
      signal: input.signal,
      onState: input.onOrderState
    });
    const state = detail?.state || order.state || 'pending';
    if (state === 'failed' || state === 'expired') {
      throw new EnergyPurchaseError('DELIVERY_FAILED', 'Payment was accepted but energy delivery failed.', {
        details: { orderId, txHash, state, detail }
      });
    }
    return { ok: true, orderId, txHash, state, detail };
  }

  async function purchase(input) {
    validateAddress(input?.payerAddress, 'payerAddress');
    requireRiskStorage(storage);
    return withPayerPurchaseLock(input.payerAddress, paymentLock, () => purchaseLocked(input));
  }

  async function reconcilePaymentRisks(payerAddress) {
    validateAddress(payerAddress, 'payerAddress');
    requireRiskStorage(storage);
    return withPayerPurchaseLock(payerAddress, paymentLock, () => reconcilePaymentRisksUnlocked(payerAddress));
  }

  async function clearPaymentRisk(payerAddress, riskId) {
    validateAddress(payerAddress, 'payerAddress');
    requireRiskStorage(storage);
    return withPayerPurchaseLock(payerAddress, paymentLock, () => clearRisk(storage, payerAddress, riskId));
  }

  return Object.freeze({
    baseUrl,
    getConfig,
    getCurrentPrice,
    getPoolHealth,
    quote,
    getOrder,
    getHistory,
    buildAndSignPayment,
    pollOrder,
    purchase,
    getPaymentRisk: payerAddress => {
      validateAddress(payerAddress, 'payerAddress');
      return readRisk(storage, payerAddress);
    },
    getPaymentRisks: payerAddress => {
      validateAddress(payerAddress, 'payerAddress');
      return readRisks(storage, payerAddress);
    },
    reconcilePaymentRisks,
    clearPaymentRisk
  });
}
