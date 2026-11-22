import { useState } from 'react';
import { coverUrl, type Book } from '../lib/api';

const PALETTES = [
  ['#7a2e1f', '#c86b3c'],
  ['#1f3d5a', '#4f7ea8'],
  ['#2f4a2b', '#6f9160'],
  ['#4b2a52', '#8f5f99'],
  ['#5a4a1f', '#b8963e'],
  ['#203f3f', '#4f8f8a'],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Cover({ book }: { book: Pick<Book, 'id' | 'title' | 'author' | 'hasCover'> }) {
  const [failed, setFailed] = useState(false);
  if (book.hasCover && !failed) {
    return <img className="cover-img" src={coverUrl(book.id)} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  const [a, b] = PALETTES[hash(book.title) % PALETTES.length];
  return (
    <div className="cover-gen" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }} aria-hidden>
      <span className="cover-gen-title">{book.title}</span>
      {book.author && <span className="cover-gen-author">{book.author}</span>}
    </div>
  );
}
