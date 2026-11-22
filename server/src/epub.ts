import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import path from 'node:path/posix';

export interface EpubMeta {
  title?: string;
  author?: string;
  cover?: { data: Buffer; ext: string };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string | undefined {
  const first = asArray(v as unknown)[0];
  if (first === undefined || first === null) return undefined;
  if (typeof first === 'string' || typeof first === 'number') return String(first).trim() || undefined;
  if (typeof first === 'object' && '#text' in (first as object)) {
    return String((first as Record<string, unknown>)['#text']).trim() || undefined;
  }
  return undefined;
}

export async function readEpubMeta(buffer: Buffer): Promise<EpubMeta> {
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('EPUB sem META-INF/container.xml');

  const container = parser.parse(containerXml);
  const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0] as Record<string, string> | undefined;
  const opfPath = rootfile?.['@_full-path'];
  if (!opfPath) throw new Error('EPUB sem arquivo OPF');

  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('OPF não encontrado');
  const pkg = parser.parse(opfXml)?.package;
  const metadata = pkg?.metadata ?? {};

  const meta: EpubMeta = {
    title: text(metadata.title),
    author: text(metadata.creator),
  };

  // Capa: EPUB3 (properties="cover-image") ou EPUB2 (<meta name="cover" content="id">)
  const items = asArray(pkg?.manifest?.item) as Record<string, string>[];
  let coverItem = items.find((i) => (i['@_properties'] ?? '').split(/\s+/).includes('cover-image'));
  if (!coverItem) {
    const coverMeta = (asArray(metadata.meta) as Record<string, string>[]).find((m) => m['@_name'] === 'cover');
    const coverId = coverMeta?.['@_content'];
    if (coverId) coverItem = items.find((i) => i['@_id'] === coverId);
  }
  if (!coverItem) {
    coverItem = items.find(
      (i) => /^image\//.test(i['@_media-type'] ?? '') && /cover/i.test(`${i['@_id']} ${i['@_href']}`),
    );
  }

  if (coverItem?.['@_href']) {
    const href = decodeURIComponent(coverItem['@_href']);
    const coverPath = path.normalize(path.join(path.dirname(opfPath), href));
    const file = zip.file(coverPath);
    if (file) {
      const ext = path.extname(coverPath).slice(1).toLowerCase() || 'jpg';
      meta.cover = { data: await file.async('nodebuffer'), ext };
    }
  }

  return meta;
}
