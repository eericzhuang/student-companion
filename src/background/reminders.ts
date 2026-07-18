/**
 * Registration reminders: chrome.alarms scheduled from each term's
 * registrationAt, notifying 24 hours and 10 minutes before the window opens.
 * Alarms are (re)computed whenever terms change and on worker startup — MV3
 * workers die, alarms don't.
 */
import type { TermConfig } from '../shared/types';
import { getAllStored } from '../shared/storage';

export const REG_ALARM_PREFIX = 'reg:';

export interface ReminderFire {
  /** alarm name: reg:<termId>:<kind> */
  name: string;
  when: number;
  kind: '24h' | '10m';
}

/** "2026-11-05T08:00" (datetime-local) -> epoch ms, or null. */
export function parseLocalDateTime(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  return Number.isNaN(t) ? null : t;
}

/** The still-future reminder firings for a set of terms. */
export function reminderFires(terms: TermConfig[], now: number): ReminderFire[] {
  const out: ReminderFire[] = [];
  for (const t of terms) {
    const at = parseLocalDateTime(t.registrationAt);
    if (at === null) continue;
    const candidates: Array<[ReminderFire['kind'], number]> = [
      ['24h', at - 24 * 60 * 60_000],
      ['10m', at - 10 * 60_000],
    ];
    for (const [kind, when] of candidates) {
      if (when > now) out.push({ name: `${REG_ALARM_PREFIX}${t.id}:${kind}`, when, kind });
    }
  }
  return out;
}

/** Human message for a firing alarm, or null if its term is gone. */
export function reminderMessage(alarmName: string, terms: TermConfig[]): { title: string; message: string } | null {
  if (!alarmName.startsWith(REG_ALARM_PREFIX)) return null;
  const [, termId, kind] = alarmName.split(':');
  const term = terms.find((t) => t.id === termId);
  if (!term) return null;
  const at = parseLocalDateTime(term.registrationAt);
  const timeText = at
    ? new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  return kind === '10m'
    ? { title: `⏰ Registration opens in 10 minutes!`, message: `${term.label} registration opens at ${timeText}. Get your courses ready.` }
    : { title: `📅 Registration tomorrow`, message: `${term.label} registration opens ${timeText}. Time to finalize your plan.` };
}

/** Clear all reg alarms and schedule the current future ones. */
export async function syncRegistrationAlarms(): Promise<void> {
  const existing = await chrome.alarms.getAll();
  await Promise.all(
    existing.filter((a) => a.name.startsWith(REG_ALARM_PREFIX)).map((a) => chrome.alarms.clear(a.name)),
  );
  const { settings } = await getAllStored();
  for (const fire of reminderFires(settings.terms, Date.now())) {
    void chrome.alarms.create(fire.name, { when: fire.when });
  }
}

/** Show the notification for a fired reg alarm. */
export async function handleRegistrationAlarm(alarmName: string): Promise<void> {
  const { settings } = await getAllStored();
  const msg = reminderMessage(alarmName, settings.terms);
  if (!msg) return;
  chrome.notifications.create(alarmName, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: msg.title,
    message: msg.message,
    priority: 2,
  });
}
