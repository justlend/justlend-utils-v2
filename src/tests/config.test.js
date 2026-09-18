import { afterEach, describe, expect, it, vi } from 'vitest';
import Config, { validateTrustedFullHost } from '../config';

describe('trusted TRON full-host validation', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('does not embed a default signing key', () => {
    expect(Config.chain).not.toHaveProperty('privateKey');
  });

  it('accepts official HTTPS and loopback HTTP endpoints', () => {
    expect(validateTrustedFullHost('https://api.trongrid.io/')).toBe('https://api.trongrid.io');
    expect(validateTrustedFullHost('http://127.0.0.1:8090/')).toBe('http://127.0.0.1:8090');
  });

  it.each(['https://nile.trongrid.io', 'https://api.nileex.io'])('accepts official Nile endpoint %s', async (host) => {
    expect(validateTrustedFullHost(`${host}/`)).toBe(host);
    vi.stubEnv('JUSTLEND_FULLHOST', host);
    vi.resetModules();
    const { default: configured } = await import('../config');
    expect(configured.chain.fullHost).toBe(host);
  });

  it.each([
    'https://api.nileex.io.attacker.example',
    'https://attacker-api.nileex.io',
    'https://api.nileex.io@attacker.example',
  ])('rejects lookalike Nile endpoint %s', host => {
    expect(() => validateTrustedFullHost(host)).toThrow(/Untrusted/);
  });

  it('rejects cleartext remote and untrusted hosts by default', () => {
    expect(() => validateTrustedFullHost('http://api.trongrid.io')).toThrow(/HTTPS/);
    expect(() => validateTrustedFullHost('https://evil.example')).toThrow(/Untrusted/);
  });

  it('allows an operator-controlled HTTPS node only with explicit opt-in', () => {
    expect(validateTrustedFullHost('https://fullnode.example/', true)).toBe('https://fullnode.example');
  });
});
