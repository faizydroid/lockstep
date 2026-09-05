/**
 * What is left of the rail's account panel.
 *
 * `AccountControl` lived here: a stacked five-state panel at the foot of a 272px left rail, carrying an
 * address, a fingerprint, four paragraphs on what connecting does and does not do, and a "Forget address"
 * button. It was replaced by `wallet-menu.tsx`, which is the same information in the shape every
 * wallet-connected dashboard uses — collapsed to an identicon and a truncated address, with the detail behind
 * a chevron.
 *
 * The component is deleted rather than left unused, because a dead 130-line component that still typechecks
 * is the kind of thing that gets rediscovered and reinstated. Its five states are documented in the new file,
 * including the two that most connect buttons skip: no wallet in the browser, and connected on the wrong
 * chain.
 *
 * Only `fingerprintSeed` survived, because it is used by the menu and by anything else that wants an
 * account's own image.
 */

/**
 * Pads a 20-byte address to the 32 bytes the fingerprint expects.
 *
 * The fingerprint is a bijection over 64 hex nibbles and rejects anything shorter rather than
 * salvaging it, which is correct for hashes and means an address cannot be passed in raw.
 * Left-padding with zeros is the same widening the EVM does when it puts an address in a word, so the
 * same account always yields the same image.
 */
export function fingerprintSeed(address: string): string {
  const body = address.replace(/^0x/, "").toLowerCase();
  return `0x${body.padStart(64, "0")}`;
}
