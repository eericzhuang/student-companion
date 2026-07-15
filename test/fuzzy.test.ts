import { describe, expect, it } from 'vitest';
import { CONFIDENT_MATCH, PLAUSIBLE_MATCH, nameKey, scoreNameMatch, splitName } from '../src/shared/fuzzy';

describe('splitName', () => {
  it('handles First Last', () => {
    expect(splitName('Jane Smith')).toEqual({ first: 'jane', middle: [], last: 'smith' });
  });
  it('handles Last, First Middle', () => {
    expect(splitName('Smith, Jane Q')).toEqual({ first: 'jane', middle: ['q'], last: 'smith' });
  });
  it('handles middle names and accents', () => {
    expect(splitName('José María García')).toEqual({
      first: 'jose',
      middle: ['maria'],
      last: 'garcia',
    });
  });
});

describe('nameKey', () => {
  it('is order-insensitive across formats', () => {
    expect(nameKey('Jane Smith')).toBe(nameKey('Smith, Jane'));
    expect(nameKey('Jane Q. Smith')).toBe(nameKey('Smith, Jane'));
  });
});

describe('scoreNameMatch', () => {
  const s = (a: string, b: string) => {
    const pa = splitName(a);
    const pb = splitName(b);
    return scoreNameMatch({ first: pa.first, last: pa.last }, { first: pb.first, last: pb.last });
  };

  it('exact match is confident', () => {
    expect(s('Jane Smith', 'Jane Smith')).toBeGreaterThanOrEqual(CONFIDENT_MATCH);
  });
  it('initial matches are confident enough', () => {
    expect(s('J Smith', 'Jane Smith')).toBeGreaterThanOrEqual(CONFIDENT_MATCH - 0.05);
  });
  it('nicknames score plausible or better', () => {
    expect(s('Mike Johnson', 'Michael Johnson')).toBeGreaterThanOrEqual(PLAUSIBLE_MATCH);
  });
  it('different people score low', () => {
    expect(s('Jane Smith', 'Robert Kowalski')).toBeLessThan(PLAUSIBLE_MATCH);
  });
  it('same last different first is not confident', () => {
    expect(s('Jane Smith', 'Robert Smith')).toBeLessThan(CONFIDENT_MATCH);
  });
});
