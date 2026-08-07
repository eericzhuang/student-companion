import { describe, expect, it } from 'vitest';
import { googleFindPlaceUrl, googleGeocodeUrl, plausibleOnCampus } from '../src/background/map';

describe('googleGeocodeUrl', () => {
  it('builds a keyed address query', () => {
    const url = googleGeocodeUrl('Statler Hall, Cornell University', 'AIza-test');
    expect(url).toContain('https://maps.googleapis.com/maps/api/geocode/json?');
    expect(url).toContain('address=Statler%20Hall%2C%20Cornell%20University');
    expect(url).toContain('key=AIza-test');
    expect(url).not.toContain('bounds=');
  });

  it('adds a ~5km campus bounds bias around the center', () => {
    const c = { lat: 42.45, lng: -76.48 };
    const url = googleGeocodeUrl('Statler Hall', 'k', c);
    expect(url).toContain(`bounds=${c.lat - 0.05},${c.lng - 0.05}|${c.lat + 0.05},${c.lng + 0.05}`);
  });

  it('escapes characters that would break the query', () => {
    const url = googleGeocodeUrl('A&B #2', 'k+/=');
    expect(url).toContain('address=A%26B%20%232');
    expect(url).toContain('key=k%2B%2F%3D');
  });
});

describe('googleFindPlaceUrl', () => {
  it('builds a Places text query with geometry field', () => {
    const url = googleFindPlaceUrl('Statler Hall', 'AIza-test');
    expect(url).toContain('/place/findplacefromtext/json?');
    expect(url).toContain('input=Statler%20Hall');
    expect(url).toContain('inputtype=textquery');
    expect(url).toContain('fields=geometry');
    expect(url).not.toContain('locationbias');
  });

  it('biases to a 5 km circle around campus', () => {
    const url = googleFindPlaceUrl('Statler Hall', 'k', { lat: 42.45, lng: -76.48 });
    expect(url).toContain('locationbias=circle%3A5000%4042.45%2C-76.48');
  });
});

describe('plausibleOnCampus', () => {
  const campus = { lat: 42.45, lng: -76.48 };

  it('accepts results on campus', () => {
    expect(plausibleOnCampus({ lat: 42.451, lng: -76.482 }, campus)).toBe(true);
  });

  it('rejects a same-named building in another city', () => {
    expect(plausibleOnCampus({ lat: 40.71, lng: -74.0 }, campus)).toBe(false);
  });

  it('rejects non-finite coordinates and accepts anything without a center', () => {
    expect(plausibleOnCampus({ lat: NaN, lng: 0 }, campus)).toBe(false);
    expect(plausibleOnCampus({ lat: 40.71, lng: -74.0 })).toBe(true);
  });
});
