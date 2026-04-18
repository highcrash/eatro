import { canonicalize } from './jcs';

describe('jcs.canonicalize', () => {
  it('orders object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it('produces identical output regardless of insertion order', () => {
    const a = canonicalize({ x: 1, y: 2, z: 3 });
    const b = canonicalize({ z: 3, y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it('handles nested objects + arrays deterministically', () => {
    const value = {
      arr: [3, 1, { z: 9, a: 1 }],
      obj: { nested: { b: 2, a: 1 } },
    };
    expect(canonicalize(value)).toBe(
      '{"arr":[3,1,{"a":1,"z":9}],"obj":{"nested":{"a":1,"b":2}}}',
    );
  });

  it('serializes primitives the same way as JSON.stringify (no whitespace)', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(0)).toBe('0');
    expect(canonicalize(-1.5)).toBe('-1.5');
    expect(canonicalize('hello')).toBe('"hello"');
  });

  it('escapes the RFC 8785 mandatory characters', () => {
    expect(canonicalize('a"b\\c\nd\te')).toBe('"a\\"b\\\\c\\nd\\te"');
  });

  it('escapes other C0 controls as \\uXXXX', () => {
    // U+0001 = \u0001
    expect(canonicalize('\u0001')).toBe('"\\u0001"');
  });

  it('throws on NaN / Infinity', () => {
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(-Infinity)).toThrow();
  });
});
