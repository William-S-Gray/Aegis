import { describe, it, expect } from 'vitest';
import { extractPlate } from '../utils/plateText';

describe('extractPlate', () => {
  it('joins a plate split by a space', () => {
    expect(extractPlate('KDA 101A\n')).toBe('KDA101A');
  });

  it('ignores the words around the plate', () => {
    expect(extractPlate('TOYOTA\nKCX 777X\nnairobi motors')).toBe('KCX777X');
  });

  it('finds a split plate with other words on the same line', () => {
    expect(extractPlate('KCX 777X KENYA')).toBe('KCX777X');
  });

  it('drops punctuation and lower case', () => {
    expect(extractPlate('ab-12 cd')).toBe('AB12CD');
  });

  it('needs letters and digits, 4 to 10 of them', () => {
    expect(extractPlate('WELCOME\n2026')).toBe('');
    expect(extractPlate('A1')).toBe('');
  });

  it('returns nothing for empty text', () => {
    expect(extractPlate('')).toBe('');
  });
});
