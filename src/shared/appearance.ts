/**
 * Dark-mode plumbing shared by the planner/options pages (a class on <html>)
 * and the content-script shadow panels (a class per root, via theme.ts).
 */
import { getStored, onStoredChange } from './storage';
import type { Settings } from './types';

export type Appearance = NonNullable<Settings['appearance']>;

export function isDark(appearance: Appearance | undefined, systemDark: boolean): boolean {
  return appearance === 'dark' || ((appearance ?? 'auto') === 'auto' && systemDark);
}

/**
 * Keep a class on <html> in sync with the appearance setting and the system
 * scheme. Call once per extension page.
 */
export function watchPageDark(className = 'pl-dark'): void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = async () => {
    const s = await getStored('settings');
    document.documentElement.classList.toggle(className, isDark(s.appearance, mql.matches));
  };
  void apply();
  mql.addEventListener('change', () => void apply());
  onStoredChange('settings', () => void apply());
}
