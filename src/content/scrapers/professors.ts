/**
 * Scan the current page for instructor/professor names, for the "rate all
 * professors on this page" feature. Prefers explicit instructor cells; falls
 * back to scanning text leaves for person-name-shaped strings.
 */
import { looksLikePersonName } from './workdayJson';
import { queryAll, textOf } from './selectors';

const MAX_NAMES = 40;

export interface ProfessorScan {
  names: string[];
  /** 'cells' = explicit instructor columns; 'fallback' = guessed from free page
   *  text, which can include non-instructors (even the student's own name), so
   *  callers must get user confirmation before sending these anywhere. */
  source: 'cells' | 'fallback';
}

export function scanProfessorNames(root: ParentNode): ProfessorScan {
  const names = new Set<string>();

  for (const el of queryAll(root, 'instructorCell')) {
    const t = textOf(el);
    // A cell may contain several names separated by commas/semicolons/"and".
    for (const part of t.split(/[;]|,\s(?=[A-Z][a-z])|\band\b/)) {
      const name = part.trim();
      if (looksLikePersonName(name)) names.add(name);
    }
  }
  if (names.size > 0) return { names: [...names].slice(0, MAX_NAMES), source: 'cells' };

  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let scanned = 0;
  while ((node = walker.nextNode()) && scanned < 8000 && names.size < MAX_NAMES) {
    scanned++;
    const t = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (t.length >= 5 && t.length <= 40 && looksLikePersonName(t)) names.add(t);
  }
  return { names: [...names].slice(0, MAX_NAMES), source: 'fallback' };
}
