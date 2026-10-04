import { PermissionFlagsBits } from 'discord-api-types/v10';

export class ConfigError extends Error {}

// Gamla alias som delar bit med ett nyare namn – accepteras men skrivs aldrig ut.
const DEPRECATED = new Set(['ManageEmojisAndStickers']);
const CANONICAL = Object.entries(PermissionFlagsBits).filter(([name]) => !DEPRECATED.has(name));

export function toBits(names = [], where = '') {
  if (!Array.isArray(names)) throw new ConfigError(`Behörigheter i ${where} måste vara en lista.`);
  let bits = 0n;
  for (const name of names) {
    const bit = PermissionFlagsBits[name];
    if (bit === undefined) {
      throw new ConfigError(`Okänd behörighet "${name}" i ${where}. Giltiga: ${CANONICAL.map(([n]) => n).join(', ')}`);
    }
    bits |= bit;
  }
  return bits;
}

export const toNames = (bits) => {
  const value = BigInt(bits);
  return CANONICAL.filter(([, bit]) => (value & bit) === bit).map(([name]) => name);
};
