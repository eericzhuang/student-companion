/**
 * "Save calendar as image": draws the week schedule to a canvas — with every
 * piece of information the calendar knows (course, time, room, professor,
 * color-coded rating, walk warnings) — and downloads it as a PNG. Drawn from
 * data, not the DOM, so it always fits and stays crisp (2× scale).
 */
import { DAYS, type Section } from '../../shared/types';
import { formatMinutes } from '../../shared/time';
import { displayInstructorName } from '../../shared/fuzzy';
import { ratingClass } from '../../shared/rmpUrl';
import { PALETTE } from './WeekGrid';

const DAY_ORDER = [
  { mask: DAYS.MON, label: 'Monday' },
  { mask: DAYS.TUE, label: 'Tuesday' },
  { mask: DAYS.WED, label: 'Wednesday' },
  { mask: DAYS.THU, label: 'Thursday' },
  { mask: DAYS.FRI, label: 'Friday' },
  { mask: DAYS.SAT, label: 'Saturday' },
  { mask: DAYS.SUN, label: 'Sunday' },
];

const RATE_COLORS: Record<string, string> = {
  good: '#86efac',
  mid: '#fcd34d',
  bad: '#fca5a5',
  none: '#e2e8f0',
};

export function exportScheduleImage(opts: {
  sections: Section[];
  termLabel: string | null;
  ratings: Map<string, number | null>;
  /** warning texts to print under the grid (walk-time alerts) */
  warningTexts: string[];
}): void {
  const { sections, termLabel, ratings, warningTexts } = opts;
  const meetings = sections.flatMap((s) => s.meetings);
  if (meetings.length === 0) return;

  const showWeekend = meetings.some((m) => m.days & (DAYS.SAT | DAYS.SUN));
  const days = showWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);
  const startHour = Math.max(0, Math.floor(Math.min(...meetings.map((m) => m.startMin)) / 60) - 1);
  const endHour = Math.min(24, Math.ceil(Math.max(...meetings.map((m) => m.endMin)) / 60) + 1);

  // Layout (logical px; canvas is drawn at 2× for crispness)
  const HOUR_W = 56;
  const DAY_W = 210;
  const HEADER_H = 78;
  const DAYROW_H = 30;
  const PX_MIN = 1.35;
  const FOOT_LINE = 20;
  const gridH = (endHour - startHour) * 60 * PX_MIN;
  const W = HOUR_W + days.length * DAY_W + 24;
  const H = HEADER_H + DAYROW_H + gridH + 26 + warningTexts.length * FOOT_LINE + 34;

  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  const FONT = '-apple-system, "Segoe UI", Roboto, sans-serif';

  // background + title
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillText(`📅 My Schedule${termLabel ? ` — ${termLabel}` : ''}`, 16, 34);
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(
    `${sections.length} sections · exported from Student Companion for Workday`,
    16,
    56,
  );

  const gx = HOUR_W;
  const gy = HEADER_H + DAYROW_H;
  const top = (min: number) => gy + (min - startHour * 60) * PX_MIN;

  // day headers + column separators
  ctx.font = `bold 13px ${FONT}`;
  days.forEach((d, i) => {
    ctx.fillStyle = '#334155';
    ctx.fillText(d.label, gx + i * DAY_W + 8, HEADER_H + 20);
  });
  ctx.strokeStyle = '#e2e8f0';
  for (let i = 0; i <= days.length; i++) {
    ctx.beginPath();
    ctx.moveTo(gx + i * DAY_W, gy);
    ctx.lineTo(gx + i * DAY_W, gy + gridH);
    ctx.stroke();
  }

  // hour lines + labels
  ctx.font = `11px ${FONT}`;
  for (let h = startHour; h <= endHour; h++) {
    const y = top(h * 60);
    ctx.strokeStyle = '#e8edf3';
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + days.length * DAY_W, y);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    const label = `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'pm' : 'am'}`;
    ctx.fillText(label, gx - ctx.measureText(label).width - 6, y + 4);
  }

  const rounded = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const clipText = (text: string, maxW: number): string => {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  };

  // event blocks with all known info
  sections.forEach((s, si) => {
    const color = PALETTE[si % PALETTE.length]!;
    for (const m of s.meetings) {
      days.forEach((d, di) => {
        if (!(m.days & d.mask)) return;
        const x = gx + di * DAY_W + 3;
        const y = top(m.startMin);
        const h = Math.max((m.endMin - m.startMin) * PX_MIN, 16);
        const w = DAY_W - 6;
        ctx.fillStyle = color;
        rounded(x, y, w, h, 6);
        ctx.fill();

        const maxW = w - 14;
        let ty = y + 15;
        const line = (text: string, font: string, fill: string) => {
          if (ty > y + h - 4) return;
          ctx.font = font;
          ctx.fillStyle = fill;
          ctx.fillText(clipText(text, maxW), x + 7, ty);
          ty += 14;
        };
        line(s.courseCode, `bold 12px ${FONT}`, '#ffffff');
        line(`${formatMinutes(m.startMin)}–${formatMinutes(m.endMin)}`, `10px ${FONT}`, 'rgba(255,255,255,0.92)');
        if (m.location) line(`📍 ${m.location}`, `10px ${FONT}`, 'rgba(255,255,255,0.92)');
        if (s.instructor) {
          const rating = ratings.get(s.instructor);
          const name = `👤 ${displayInstructorName(s.instructor)}`;
          if (rating != null && ty <= y + h - 4) {
            ctx.font = `10px ${FONT}`;
            const nameShown = clipText(name, maxW - 34);
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.fillText(nameShown, x + 7, ty);
            ctx.fillStyle = RATE_COLORS[ratingClass(rating)]!;
            ctx.font = `bold 10px ${FONT}`;
            ctx.fillText(` ★${rating.toFixed(1)}`, x + 7 + ctx.measureText(nameShown).width + 2, ty);
            ty += 14;
          } else {
            line(name, `10px ${FONT}`, 'rgba(255,255,255,0.92)');
          }
        }
      });
    }
  });

  // walk warnings under the grid
  let fy = gy + gridH + 24;
  if (warningTexts.length > 0) {
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillStyle = '#b91c1c';
    ctx.fillText('⚠ Walk-time warnings', 16, fy);
    fy += FOOT_LINE;
    ctx.font = `11px ${FONT}`;
    for (const t of warningTexts) {
      ctx.fillStyle = '#7f1d1d';
      ctx.fillText(clipText(t, W - 32), 16, fy);
      fy += FOOT_LINE;
    }
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule${termLabel ? `-${termLabel.replace(/\s+/g, '-').toLowerCase()}` : ''}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}
