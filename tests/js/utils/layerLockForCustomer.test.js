import { isLayerLockedForCustomer } from '../../../shared/js/layerLockForCustomer';

describe('isLayerLockedForCustomer', () => {
  // RULING R21: asymmetric defaults chosen from the live-data measurement
  // (124 svg layers with locked unset, 19 text with locked:false, 1 text
  // with locked:true, 1 image with locked:true). Each default preserves
  // what that layer type already did today when `locked` is unset.

  describe('text layers — default movable', () => {
    it('is NOT locked when locked is unset', () => {
      expect(isLayerLockedForCustomer({ type: 'text' })).toBe(false);
    });

    it('is NOT locked when locked is explicitly false', () => {
      expect(isLayerLockedForCustomer({ type: 'text', locked: false })).toBe(false);
    });

    it('IS locked only when locked is explicitly true', () => {
      expect(isLayerLockedForCustomer({ type: 'text', locked: true })).toBe(true);
    });
  });

  describe('svg layers — default locked', () => {
    it('IS locked when locked is unset', () => {
      expect(isLayerLockedForCustomer({ type: 'svg' })).toBe(true);
    });

    it('is NOT locked only when locked is explicitly false', () => {
      expect(isLayerLockedForCustomer({ type: 'svg', locked: false })).toBe(false);
    });

    it('IS locked when locked is explicitly true', () => {
      expect(isLayerLockedForCustomer({ type: 'svg', locked: true })).toBe(true);
    });
  });

  describe('image layers — default locked', () => {
    it('IS locked when locked is unset', () => {
      expect(isLayerLockedForCustomer({ type: 'image' })).toBe(true);
    });

    it('is NOT locked only when locked is explicitly false', () => {
      expect(isLayerLockedForCustomer({ type: 'image', locked: false })).toBe(false);
    });

    it('IS locked when locked is explicitly true', () => {
      expect(isLayerLockedForCustomer({ type: 'image', locked: true })).toBe(true);
    });
  });

  it('tolerates a null or undefined layer without throwing', () => {
    expect(() => isLayerLockedForCustomer(null)).not.toThrow();
    expect(() => isLayerLockedForCustomer(undefined)).not.toThrow();
    expect(isLayerLockedForCustomer(null)).toBe(true);
    expect(isLayerLockedForCustomer(undefined)).toBe(true);
  });
});
