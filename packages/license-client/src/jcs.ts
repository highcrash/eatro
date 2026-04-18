/**
 * JCS — JSON Canonicalization Scheme (RFC 8785).
 *
 * Duplicated from apps/license-server/src/crypto/jcs.ts. Must produce
 * byte-identical output for any given input — when you touch one,
 * touch the other. A spec (jcs.spec.ts in BOTH packages) pins the
 * invariant against regressions.
 */

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

export function canonicalize(value: unknown): string {
  return canonicalizeInner(value as JsonValue);
}

function canonicalizeInner(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return numberLiteral(value);
  if (typeof value === 'string') return stringLiteral(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeInner).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return (
      '{' +
      keys.map((k) => stringLiteral(k) + ':' + canonicalizeInner(value[k])).join(',') +
      '}'
    );
  }
  throw new TypeError(`canonicalize: unsupported value of type ${typeof value}`);
}

function numberLiteral(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError('canonicalize: NaN/Infinity are not valid JSON');
  }
  return JSON.stringify(n);
}

function stringLiteral(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0d) out += '\\r';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += s[i];
  }
  return out + '"';
}
