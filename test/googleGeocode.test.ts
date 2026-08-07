import { describe, expect, it } from 'vitest';
import { googleGeocodeUrl } from '../src/background/map';

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
