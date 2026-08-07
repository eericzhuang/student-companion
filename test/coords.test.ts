import { describe, expect, it } from 'vitest';
import { parseLatLng } from '../src/shared/coords';

describe('parseLatLng', () => {
  it('parses a bare "lat, lng" pair (with or without parentheses)', () => {
    expect(parseLatLng('42.4459, -76.4844')).toEqual({ lat: 42.4459, lng: -76.4844 });
    expect(parseLatLng('(42.4459,-76.4844)')).toEqual({ lat: 42.4459, lng: -76.4844 });
  });

  it('prefers the place pin (!3d/!4d) over the viewport (@) in a place URL', () => {
    const url =
      'https://www.google.com/maps/place/Statler+Hall/@42.4451039,-76.4834,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d42.4455556!4d-76.4823946!16s';
    expect(parseLatLng(url)).toEqual({ lat: 42.4455556, lng: -76.4823946 });
  });

  it('parses the viewport "@" pair when no place pin exists', () => {
    expect(parseLatLng('https://www.google.com/maps/@42.4451,-76.4834,17z')).toEqual({
      lat: 42.4451,
      lng: -76.4834,
    });
  });

  it('parses search-style query params', () => {
    expect(parseLatLng('https://www.google.com/maps/search/?api=1&query=42.44,-76.48')).toEqual({
      lat: 42.44,
      lng: -76.48,
    });
    expect(parseLatLng('https://maps.google.com/?q=42.44%2C-76.48')).toEqual({
      lat: 42.44,
      lng: -76.48,
    });
  });

  it('rejects garbage and out-of-range values', () => {
    expect(parseLatLng('Statler Hall')).toBeNull();
    expect(parseLatLng('')).toBeNull();
    expect(parseLatLng('123.5, 20')).toBeNull();
    expect(parseLatLng('42, 200')).toBeNull();
  });
});
