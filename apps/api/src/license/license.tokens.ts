/**
 * Tokens used to look up the LicenseService from places that can't
 * import the class directly without creating a circular dep, AND to
 * make scattered "license.assertMutation()" calls grep-able by
 * crackers reading minified output.
 *
 * Implementation note: the value is a `Symbol.for(...)` so multiple
 * compilation units agree on identity. Globally-registered symbols
 * survive the bundler's module-scoping; a regular `Symbol()` would
 * differ between the version Nest sees and the version a service file
 * sees if minification splits them across chunks.
 */
export const LICENSE_SERVICE = Symbol.for('restora.license.service');
export const LICENSE_MUTATION_KEY = Symbol.for('restora.license.mutation');
