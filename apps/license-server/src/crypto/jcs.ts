/**
 * JCS — JSON Canonicalization Scheme (RFC 8785).
 *
 * Why this exists: ed25519 signs bytes, not "JSON values". If the server
 * signs `JSON.stringify(payload)` and the client reads `payload` then
 * recomputes `JSON.stringify(...)` to verify, the two strings will differ
 * whenever a key order, whitespace, or number representation drifts —
 * and the signature check will fail.
 *
 * JCS picks a single canonical byte representation:
 *  - Object keys sorted lexicographically by UTF-16 code unit
 *  - No whitespace
 *  - Strings escaped per the RFC's minimal-escape rules
 *  - Numbers serialized via ECMA-262 "ToString(Number)" (RFC 8785 §3.2.2)
 *
 * Implemented in-house (zero deps) because the published JCS libraries
 * pull in ICU-sized polyfills we don't need and the spec is small.
 *
 * Constraints honoured:
 *  - Only JSON-compatible inputs: null, boolean, number, string, array,
 *    object. NaN/Infinity throw — they aren't valid JSON.
 *  - Object keys must be strings (per JSON).
 *  - Stable across Node versions because we don't rely on
 *    `JSON.stringify` for objects/arrays (which gives no key-order
 *    guarantee for objects).
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

export function canonicalize(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return numberLiteral(value);
  if (typeof value === 'string') return stringLiteral(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    // RFC 8785: sort by UTF-16 code units. JS string compare is already
    // code-unit ordered, so a plain Array.sort() does the job.
    const keys = Object.keys(value).sort();
    return (
      '{' +
      keys
        .map((k) => stringLiteral(k) + ':' + canonicalize(value[k]))
        .join(',') +
      '}'
    );
  }
  throw new TypeError(`canonicalize: unsupported value of type ${typeof value}`);
}

/** ECMA-262 ToString(Number), per RFC 8785 §3.2.2. */
function numberLiteral(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError('canonicalize: NaN/Infinity are not valid JSON');
  }
  // Node's Number.prototype.toString and JSON.stringify both implement
  // the ECMA-262 ToString(Number) algorithm, so JSON.stringify is fine
  // for primitives. Verified across Node 18+/22+.
  return JSON.stringify(n);
}

/**
 * RFC 8785 §3.2.1 escape rules:
 *  - U+0022 (") → \"
 *  - U+005C (\) → \\
 *  - U+0008 → \b, U+0009 → \t, U+000A → \n, U+000C → \f, U+000D → \r
 *  - Other C0 controls (U+0000–001F) → \uXXXX (lowercase hex)
 *  - Everything else literal (including non-ASCII).
 *
 * Surrogate pairs are passed through as-is; we don't validate that an
 * input string is well-formed UTF-16 (matches JSON.stringify behaviour).
 */
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
  out += '"';
  return out;
}
