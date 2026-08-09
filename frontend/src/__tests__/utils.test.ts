import { describe, it, expect } from 'vitest';
import { asArray, asObject, asNumber } from '../utils/safe';

/**
 * These coercions exist because the analytics page white-screened when an API
 * call returned SPA fallback HTML and the resulting string reached recharts.
 */
describe('asArray', () => {
  it('passes arrays through', () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
  });

  it('converts an HTML string response to an empty array', () => {
    expect(asArray('<!doctype html><html></html>')).toEqual([]);
  });

  it.each([null, undefined, 42, {}, true])('converts %s to an empty array', (value) => {
    expect(asArray(value)).toEqual([]);
  });
});

describe('asObject', () => {
  it('passes plain objects through', () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
  });

  it.each([null, undefined, 'html', [1, 2], 7])('converts %s to an empty object', (value) => {
    expect(asObject(value)).toEqual({});
  });
});

describe('asNumber', () => {
  it('passes finite numbers through', () => {
    expect(asNumber(3.5)).toBe(3.5);
  });

  it.each([NaN, Infinity, '5', null, undefined])('falls back for %s', (value) => {
    expect(asNumber(value)).toBe(0);
  });

  it('honours a custom fallback', () => {
    expect(asNumber(undefined, 1)).toBe(1);
  });
});
