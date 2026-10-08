import { describe, it, expect } from 'vitest';
import { groupVipPhotos } from '../../supabase/functions/_shared/vipGallery';
describe('one garment per VIP upload', () => {
  it('combines six photos into one ordered gallery and unions available details', () => {
    const group = groupVipPhotos(['1', '2', '3', '4', '5', '6'], [
      { colors: ['Brown'], size: '40' }, { colors: ['Red'], size: '42' },
      { colors: ['Gold'], size: '40' }, { colors: ['Blue'] }, { colors: ['Black'] }, { colors: ['Black'] },
    ]);
    expect(group.gallery.map((p) => p.url)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(group.colors).toEqual(['Brown', 'Red', 'Gold', 'Blue', 'Black']);
    expect(group.sizes).toEqual(['40', '42']);
    expect(Array.isArray(group.primary)).toBe(false);
    expect(group.primary?.size).toBe('40');
  });
  it('retains failed photos for review rather than losing images', () => {
    const group = groupVipPhotos(['a', 'b'], [null, { colors: ['White'], confidence: 0.9 }]);
    expect(group.gallery).toHaveLength(2);
    expect(group.needsReview).toBe(true);
    expect(group.primary?.colors).toEqual(['White']);
  });
});