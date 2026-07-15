/**
 * PDF → text extraction for uploaded transcripts, using pdfjs. Runs in the
 * options page (extension origin), reconstructing line breaks from the text
 * items' y-coordinates so the transcript parser sees one course per line.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // items are TextItem | TextMarkedContent; keep the ones with text + position
    const items = content.items as Array<{ str?: string; transform?: number[] }>;

    let currentY: number | null = null;
    let current = '';
    for (const item of items) {
      if (typeof item.str !== 'string' || !item.transform) continue;
      const y = item.transform[5]!;
      if (currentY === null || Math.abs(y - currentY) <= 2) {
        current += (current && !current.endsWith(' ') ? ' ' : '') + item.str;
      } else {
        if (current.trim()) lines.push(current.trim());
        current = item.str;
      }
      currentY = y;
    }
    if (current.trim()) lines.push(current.trim());
  }

  return lines.join('\n');
}
