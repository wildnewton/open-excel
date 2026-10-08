// Browser crypto shim - uses the Web Crypto API
const crypto = globalThis.crypto || {};

export default crypto;
export const webcrypto = crypto;
export const subtle = crypto.subtle;
export const getRandomValues = (array) => crypto.getRandomValues(array);
export const randomUUID = () => crypto.randomUUID();

export function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function createHash() {
  throw new Error("createHash is not available in browser");
}

export function createHmac() {
  throw new Error("createHmac is not available in browser");
}
