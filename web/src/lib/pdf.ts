import { pdfjs } from 'react-pdf';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export { pdfjs };

/** Lê título/autor e renderiza a 1ª página como capa, no navegador, antes do upload. */
export async function extractPdfMeta(file: File): Promise<{ title?: string; author?: string; cover?: Blob }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const out: { title?: string; author?: string; cover?: Blob } = {};
    try {
      const { info } = (await doc.getMetadata()) as { info: Record<string, unknown> };
      if (typeof info?.Title === 'string' && info.Title.trim()) out.title = info.Title.trim();
      if (typeof info?.Author === 'string' && info.Author.trim()) out.author = info.Author.trim();
    } catch {
      /* sem metadados */
    }

    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 400 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    out.cover = (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))) ?? undefined;
    return out;
  } finally {
    void task.destroy();
  }
}
