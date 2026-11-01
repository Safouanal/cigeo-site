import { ADSTERRA_NATIVE_DESCRIPTOR } from './adsterra-native.js';

// Public placement identities copied from the approved cigeo.fr account.
const banner = (id, width, height, key) => Object.freeze({
  id, type: 'banner', width, height, key, scriptSrc: `https://bauval.org/22/${key}`,
});
export const ADSTERRA_UNITS = Object.freeze({
  '32040685': Object.freeze({ ...ADSTERRA_NATIVE_DESCRIPTOR, type: 'native' }),
  '32040497': banner('32040497', 468, 60, 'ab6b2492220941278fc6e148fcc411dd'),
  '32040498': banner('32040498', 300, 250, '2be2f454d05243b0e2cb16e7bd70095f'),
  '32040499': banner('32040499', 160, 300, 'e8881df7d6bce10516d9572f5d224c50'),
  '32040500': banner('32040500', 320, 50, '1b6d87a0d110524e75ed3665d5169a70'),
  '32040501': banner('32040501', 728, 90, '878a8e2b45e3c41ff4853bec1df07e2a'),
  '32040686': banner('32040686', 160, 600, '808827a193d6cfc90be0e327b2ac6f9a'),
});

export function isApprovedAdsterraVariant(variant) {
  if (!variant || typeof variant.id !== 'string' || !Object.hasOwn(ADSTERRA_UNITS, variant.id)) return false;
  const unit = ADSTERRA_UNITS[variant.id];
  return unit.type === 'native'
    ? variant.responsive === true && variant.minWidth === unit.minWidth
    : variant.responsive !== true && variant.width === unit.width && variant.height === unit.height;
}
