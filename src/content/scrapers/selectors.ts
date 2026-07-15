/**
 * Selector abstraction: scrapers ask for logical element names; resolution
 * tries user overrides (settings.selectorOverrides) first, then the shipped
 * defaults, returning the first candidate that matches. This keeps every raw
 * CSS selector out of scraper logic and per-school fixable without a rebuild.
 */
import defaults from './selectors.default.json';

export type LogicalSelector = keyof typeof defaults;

let overrides: Record<string, string[]> = {};

export function setSelectorOverrides(next: Record<string, string[]>): void {
  overrides = next;
}

export function candidatesFor(name: LogicalSelector): string[] {
  return [...(overrides[name] ?? []), ...defaults[name]];
}

export function queryFirst(root: ParentNode, name: LogicalSelector): Element | null {
  for (const sel of candidatesFor(name)) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // invalid user-supplied selector — skip
    }
  }
  return null;
}

export function queryAll(root: ParentNode, name: LogicalSelector): Element[] {
  for (const sel of candidatesFor(name)) {
    try {
      const els = root.querySelectorAll(sel);
      if (els.length > 0) return [...els];
    } catch {
      // invalid user-supplied selector — skip
    }
  }
  return [];
}

export function textOf(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
