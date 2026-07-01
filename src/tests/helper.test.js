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
import { describe, it, expect } from 'vitest';
import { formatNumber, toChainAmount } from '../utils/helper';

describe('formatNumber', () => {
  it('formats integer with commas', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});

describe('toChainAmount', () => {
  it('scales a clean amount to an integer uint256 string', () => {
    expect(toChainAmount('100', 6)).toBe('100000000');
    expect(toChainAmount('1.5', 6)).toBe('1500000');
  });

  it('floors (ROUND_DOWN) sub-decimal precision instead of emitting a fraction', () => {
    // 0.0000001 * 1e6 = 0.1 → must floor to 0, never the ABI-breaking "0.1"
    expect(toChainAmount('0.0000001', 6)).toBe('0');
  });

  it('rejects a negative amount before it can two’s-complement wrap a uint256', () => {
    expect(() => toChainAmount('-1', 6)).toThrow(/invalid amount/);
  });

  it('rejects non-finite / invalid decimals', () => {
    expect(() => toChainAmount('1', undefined)).toThrow(/invalid decimals/);
    expect(() => toChainAmount('1', NaN)).toThrow(/invalid decimals/);
    expect(() => toChainAmount('1', -1)).toThrow(/invalid decimals/);
    expect(() => toChainAmount('abc', 6)).toThrow(/invalid amount/);
  });
});
