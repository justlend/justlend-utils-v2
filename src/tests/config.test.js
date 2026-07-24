import { describe, expect, it } from 'vitest';
import Config, { validateTrustedFullHost } from '../config';

describe('trusted TRON full-host validation', () => {
  it('does not embed a default signing key', () => {
    expect(Config.chain).not.toHaveProperty('privateKey');
  });

  it('accepts official HTTPS and loopback HTTP endpoints', () => {
    expect(validateTrustedFullHost('https://api.trongrid.io/')).toBe('https://api.trongrid.io');
    expect(validateTrustedFullHost('http://127.0.0.1:8090/')).toBe('http://127.0.0.1:8090');
  });

  it('rejects cleartext remote and untrusted hosts by default', () => {
    expect(() => validateTrustedFullHost('http://api.trongrid.io')).toThrow(/HTTPS/);
    expect(() => validateTrustedFullHost('https://evil.example')).toThrow(/Untrusted/);
  });

  it('allows an operator-controlled HTTPS node only with explicit opt-in', () => {
    expect(validateTrustedFullHost('https://fullnode.example/', true)).toBe('https://fullnode.example');
  });
});
