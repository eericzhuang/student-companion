import { describe, expect, it } from 'vitest';
import { scenarioMetrics } from '../src/shared/scenario';
import { DAYS, type CampusBuilding, type Section } from '../src/shared/types';

const sec = (code: string, over: Partial<Section> = {}): Section => ({
  sectionId: code,
  courseCode: code,
  title: code,
  credits: 3,
  instructor: null,
  meetings: [{ days: DAYS.MON, startMin: 600, endMin: 650 }],
  ...over,
});

describe('scenarioMetrics', () => {
  it('sums credits treating null as 0, finds earliest start', () => {
    const m = scenarioMetrics(
      [
        sec('A', { credits: 4, meetings: [{ days: DAYS.MON, startMin: 540, endMin: 590 }] }),
        sec('B', { credits: null, meetings: [{ days: DAYS.TUE, startMin: 480, endMin: 530 }] }),
      ],
      new Map(),
      {},
      4.8,
    );
    expect(m.credits).toBe(4);
    expect(m.earliest).toBe('8:00 AM');
    expect(m.sections).toBe(2);
    expect(m.avgRating).toBeNull();
  });

  it('averages only rated instructors', () => {
    const ratings = new Map<string, number | null>([
      ['Prof A', 4.0],
      ['Prof B', null],
      ['Prof C', 2.0],
    ]);
    const m = scenarioMetrics(
      [
        sec('A', { instructor: 'Prof A' }),
        sec('B', { instructor: 'Prof B', meetings: [{ days: DAYS.TUE, startMin: 700, endMin: 750 }] }),
        sec('C', { instructor: 'Prof C', meetings: [{ days: DAYS.WED, startMin: 700, endMin: 750 }] }),
      ],
      ratings,
      {},
      4.8,
    );
    expect(m.avgRating).toBe(3.0);
  });

  it('totals weekly walking and counts risky legs', () => {
    // Two Monday classes ~2km apart with a 10-minute break → miss risk.
    const buildings: Record<string, CampusBuilding> = {
      Olin: { lat: 42.465, lng: -76.4835, source: 'osm' },
      Hollister: { lat: 42.4445, lng: -76.4847, source: 'osm' },
    };
    const m = scenarioMetrics(
      [
        sec('A', { meetings: [{ days: DAYS.MON, startMin: 600, endMin: 650, location: 'Olin 155' }] }),
        sec('B', { meetings: [{ days: DAYS.MON, startMin: 660, endMin: 710, location: 'Hollister 110' }] }),
      ],
      new Map(),
      buildings,
      4.8,
    );
    expect(m.walkMinPerWeek).toBeGreaterThan(0);
    expect(m.riskyLegs).toBe(1);
  });
});
