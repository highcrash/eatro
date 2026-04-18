import { normalizeHost, normalizePattern, domainMatches } from './domain-match';

describe('normalizeHost (client)', () => {
  it('lower-cases + strips port + trailing dot + www.', () => {
    expect(normalizeHost('  Www.Example.COM.:8080 ')).toBe('example.com');
  });
});

describe('normalizePattern (client)', () => {
  it('keeps *. prefix', () => {
    expect(normalizePattern('*.Example.COM')).toBe('*.example.com');
  });
});

describe('domainMatches (client — matches server semantics)', () => {
  it('plain exact', () => {
    expect(domainMatches('example.com', 'example.com')).toBe(true);
    expect(domainMatches('example.com', 'sub.example.com')).toBe(false);
  });
  it('wildcard covers root + subdomains', () => {
    expect(domainMatches('*.example.com', 'example.com')).toBe(true);
    expect(domainMatches('*.example.com', 'app.example.com')).toBe(true);
    expect(domainMatches('*.example.com', 'a.b.c.example.com')).toBe(true);
  });
  it('suffix-append attacks rejected', () => {
    expect(domainMatches('*.example.com', 'notexample.com')).toBe(false);
    expect(domainMatches('*.example.com', 'example.com.attacker.io')).toBe(false);
  });
});
