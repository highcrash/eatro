import { normalizeHost, normalizePattern, domainMatches, describeMatch } from './domain-match';

describe('normalizeHost', () => {
  it('lower-cases + trims', () => {
    expect(normalizeHost('  Example.COM ')).toBe('example.com');
  });
  it('strips trailing dot', () => {
    expect(normalizeHost('example.com.')).toBe('example.com');
  });
  it('strips :port', () => {
    expect(normalizeHost('example.com:8080')).toBe('example.com');
  });
  it('strips leading www.', () => {
    expect(normalizeHost('www.example.com')).toBe('example.com');
  });
});

describe('normalizePattern', () => {
  it('preserves *. prefix', () => {
    expect(normalizePattern('*.Example.COM')).toBe('*.example.com');
  });
  it('does NOT strip www. after *. prefix (wildcard handles it)', () => {
    // *.example.com already covers www.example.com — no need to strip.
    expect(normalizePattern('*.example.com')).toBe('*.example.com');
  });
  it('plain domain falls through to normalizeHost behaviour', () => {
    expect(normalizePattern('www.example.com.')).toBe('example.com');
  });
});

describe('domainMatches (plain patterns)', () => {
  it('matches exact host', () => {
    expect(domainMatches('example.com', 'example.com')).toBe(true);
  });
  it('does NOT accept subdomains', () => {
    expect(domainMatches('example.com', 'sub.example.com')).toBe(false);
  });
  it('rejects unrelated host', () => {
    expect(domainMatches('example.com', 'other.com')).toBe(false);
  });
});

describe('domainMatches (wildcard patterns)', () => {
  it('accepts bare root', () => {
    expect(domainMatches('*.example.com', 'example.com')).toBe(true);
  });
  it('accepts single-label subdomain', () => {
    expect(domainMatches('*.example.com', 'app.example.com')).toBe(true);
  });
  it('accepts deep subdomains', () => {
    expect(domainMatches('*.example.com', 'a.b.c.example.com')).toBe(true);
  });
  it('rejects suffix-append attack', () => {
    // Classic bug: endsWith("example.com") would falsely match this.
    // We require the match to end with ".example.com" OR equal "example.com".
    expect(domainMatches('*.example.com', 'notexample.com')).toBe(false);
    expect(domainMatches('*.example.com', 'example.com.attacker.io')).toBe(false);
  });
  it('rejects sibling domain', () => {
    expect(domainMatches('*.example.com', 'example.org')).toBe(false);
  });
  it('rejects empty inputs', () => {
    expect(domainMatches('', 'example.com')).toBe(false);
    expect(domainMatches('*.example.com', '')).toBe(false);
  });
});

describe('describeMatch', () => {
  it('returns ok + exact reason for plain match', () => {
    const r = describeMatch('example.com', 'Example.COM');
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/exact/);
    expect(r.normalizedHost).toBe('example.com');
    expect(r.normalizedPattern).toBe('example.com');
  });
  it('returns ok + wildcard reason for subdomain match', () => {
    const r = describeMatch('*.example.com', 'app.example.com');
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/wildcard/);
  });
  it('returns a helpful reason when plain license is tried with subdomain', () => {
    const r = describeMatch('example.com', 'sub.example.com');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/plain/);
  });
  it('returns a helpful reason when wildcard is tried with unrelated host', () => {
    const r = describeMatch('*.example.com', 'example.org');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside/);
  });
});
