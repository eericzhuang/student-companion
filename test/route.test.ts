import { describe, expect, it } from 'vitest';
import {
  buildingOf,
  dayTransitions,
  haversineMeters,
  walkMinutes,
  WALK_FUDGE,
} from '../src/shared/route';
import { DAYS, type CampusBuilding, type Section } from '../src/shared/types';

describe('buildingOf', () => {
  it('strips room designators and bare room numbers', () => {
    expect(buildingOf('Baker Hall 200')).toBe('Baker Hall');
    expect(buildingOf('Uris Hall 302B')).toBe('Uris Hall');
    expect(buildingOf('Gates Hall Rm 114')).toBe('Gates Hall');
    expect(buildingOf('Statler Hall Room 196')).toBe('Statler Hall');
    expect(buildingOf('  Klarman   Hall  ')).toBe('Klarman Hall');
  });
  it('never returns empty', () => {
    expect(buildingOf('200')).toBe('200');
  });
});

describe('walk math', () => {
  it('haversine on a known pair (~1.11 km per 0.01° latitude)', () => {
    const d = haversineMeters({ lat: 42.44, lng: -76.48 }, { lat: 42.45, lng: -76.48 });
    expect(d).toBeGreaterThan(1080);
    expect(d).toBeLessThan(1140);
  });
  it('walkMinutes applies speed and fudge', () => {
    // 800m at 4.8 km/h (80 m/min): 800*1.3/80 = 13 min
    expect(walkMinutes(800, 4.8)).toBeCloseTo((800 * WALK_FUDGE) / 80, 5);
  });
});

const section = (id: string, startMin: number, endMin: number, location?: string): Section => ({
  sectionId: id,
  courseCode: id,
  title: id,
  credits: 3,
  instructor: null,
  meetings: [{ days: DAYS.MON, startMin, endMin, location }],
});

// ~2.2 km apart (over a mile)
const BUILDINGS: Record<string, CampusBuilding> = {
  'Baker Hall': { lat: 42.44, lng: -76.48, source: 'manual' },
  'Far Hall': { lat: 42.46, lng: -76.48, source: 'manual' },
};

describe('dayTransitions', () => {
  it('flags a 10-minute break with a 2km walk as miss', () => {
    const t = dayTransitions(
      [section('A', 600, 650, 'Baker Hall 200'), section('B', 660, 710, 'Far Hall 101')],
      BUILDINGS,
    );
    expect(t).toHaveLength(1);
    expect(t[0]!.breakMin).toBe(10);
    expect(t[0]!.walkMin!).toBeGreaterThan(10);
    expect(t[0]!.risk).toBe('miss');
  });

  it('same building is ok with zero walk', () => {
    const t = dayTransitions(
      [section('A', 600, 650, 'Baker Hall 200'), section('B', 660, 710, 'Baker Hall 301')],
      BUILDINGS,
    );
    expect(t[0]!.risk).toBe('ok');
    expect(t[0]!.walkMin).toBe(0);
  });

  it('missing coordinates → unknown, never a false alarm', () => {
    const t = dayTransitions(
      [section('A', 600, 650, 'Mystery Hall 1'), section('B', 660, 710, 'Far Hall 101')],
      BUILDINGS,
    );
    expect(t[0]!.risk).toBe('unknown');
    expect(t[0]!.walkMin).toBeNull();
  });

  it('long break is ok even across campus', () => {
    const t = dayTransitions(
      [section('A', 600, 650, 'Baker Hall 200'), section('B', 780, 830, 'Far Hall 101')],
      BUILDINGS,
    );
    expect(t[0]!.breakMin).toBe(130);
    expect(t[0]!.risk).toBe('ok');
  });
});
