/**
 * Minimális PDF-olvasó — CSAK annyit tud, amennyit a sávbeosztás-táblázatokhoz kell.
 *
 * MIÉRT VAN EZ ITT? A budapesti uszodák „pályabeosztás” PDF-jei Excelből
 * exportált rácsok. A szöveges réteg csak a FEJLÉCEKET tartalmazza (órasávok,
 * pályaszámok); azt, hogy egy cella foglalt-e, KIZÁRÓLAG a cella KITÖLTŐSZÍNE
 * mondja meg. Ezért nem elég a szövegkinyerés: a kitöltött téglalapokat is
 * ki kell olvasni. Mivel külső PDF-könyvtárat nem telepíthetünk, a tartalmi
 * folyamot (content stream) magunk bontjuk fel — a `zlib` a Node része.
 *
 * KORLÁTOK (tudatosak, és a hívó adapter ellenőrzi is a következményüket):
 *  - csak a `FlateDecode` szűrőt ismerjük (az Excel-export ilyet használ),
 *  - a koordináta-transzformációkat (`cm`) nem alkalmazzuk; az Excel-exportban
 *    a rács az alap felhasználói térben van,
 *  - a részhalmaz-betűk (subset font) hexa glifakódjait nem fordítjuk vissza
 *    Unicode-ra, azokat `#`-kal kezdődő nyers alakban adjuk vissza.
 */

import zlib from 'node:zlib';

export interface PdfTextItem {
  x: number;
  y: number;
  text: string;
}

export interface PdfFilledRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Kitöltőszín 0..1 tartományban. */
  color: [number, number, number];
}

export interface PdfPage {
  index: number;
  texts: PdfTextItem[];
  rects: PdfFilledRect[];
}

/** Egy PDF-objektum nyers, kitömörített folyama (vagy `null`). */
function readObjectStream(pdf: Buffer, latin: string, objectNumber: number): Buffer | null {
  const pattern = new RegExp(`(?:^|[^0-9])${objectNumber}\\s+0\\s+obj`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(latin)) !== null) {
    const streamAt = latin.indexOf('stream', match.index);
    const endObjAt = latin.indexOf('endobj', match.index);
    if (streamAt < 0) continue;
    if (endObjAt >= 0 && streamAt > endObjAt) continue;

    let start = streamAt + 'stream'.length;
    if (latin[start] === '\r') start += 1;
    if (latin[start] === '\n') start += 1;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;

    const body = pdf.subarray(start, end);
    try {
      return zlib.inflateSync(body);
    } catch {
      // Szűretlen (vagy általunk nem ismert szűrőjű) folyam: adjuk vissza nyersen.
      return body;
    }
  }
  return null;
}

/** A `/Pages` fa `/Kids` tömbje — az oldalak dokumentum szerinti sorrendjében. */
function pageObjectNumbers(latin: string): number[] {
  const kids = /\/Type\s*\/Pages[\s\S]{0,400}?\/Kids\s*\[([^\]]*)\]/.exec(latin);
  if (!kids) return [];
  return [...kids[1].matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1]));
}

function contentObjectNumber(latin: string, pageObject: number): number | null {
  const dict = new RegExp(`(?:^|[^0-9])${pageObject}\\s+0\\s+obj([\\s\\S]{0,1200}?)endobj`).exec(latin);
  if (!dict) return null;
  const contents = /\/Contents\s+(\d+)\s+0\s+R/.exec(dict[1]);
  return contents ? Number(contents[1]) : null;
}

/** A PDF-karakterlánc literál feloldása (zárójelek, escape-ek). */
function decodeLiteral(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(/\\([nrtbf()\\])/g, (_all, ch: string) => {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      return map[ch] ?? ch;
    })
    .replace(/\\(\d{1,3})/g, (_all, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

function textFromOperand(operand: string): string {
  if (operand.startsWith('(')) return decodeLiteral(operand);
  if (operand.startsWith('<')) return `#${operand.slice(1, -1).replace(/\s+/g, '')}`;
  if (operand.startsWith('[')) {
    const parts = operand.match(/\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>/g) ?? [];
    return parts.map(textFromOperand).join('');
  }
  return '';
}

const TOKEN_RE = /\[(?:[^\[\]\\]|\\.)*\]|\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>|[^\s\[\]<>()]+/g;

/** Egyetlen tartalmi folyam feldolgozása szöveg- és téglalap-listává. */
function parseContentStream(content: string): { texts: PdfTextItem[]; rects: PdfFilledRect[] } {
  const texts: PdfTextItem[] = [];
  const rects: PdfFilledRect[] = [];

  const tokens = content.match(TOKEN_RE) ?? [];
  let operands: string[] = [];

  let fill: [number, number, number] = [0, 0, 0];
  const fillStack: [number, number, number][] = [];
  let pendingRects: { x: number; y: number; width: number; height: number }[] = [];
  let cursor: { x: number; y: number } | null = null;

  const numbers = (count: number): number[] =>
    operands.slice(-count).map((value) => Number(value) || 0);

  for (const token of tokens) {
    // Operandus?
    if (/^[-+.\d]/.test(token) || token.startsWith('(') || token.startsWith('<') || token.startsWith('[') || token.startsWith('/')) {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'q':
        fillStack.push([...fill] as [number, number, number]);
        break;
      case 'Q': {
        const restored = fillStack.pop();
        if (restored) fill = restored;
        break;
      }
      case 'rg':
      case 'sc':
      case 'scn': {
        const values = operands.filter((o) => /^[-+.\d]/.test(o));
        if (values.length >= 3) {
          const [r, g, b] = values.slice(-3).map(Number);
          fill = [r, g, b];
        } else if (values.length === 1) {
          const v = Number(values[0]);
          fill = [v, v, v];
        }
        break;
      }
      case 'g': {
        const [v] = numbers(1);
        fill = [v, v, v];
        break;
      }
      case 'k': {
        // CMYK → RGB közelítés; a rácsoknál ritka, de ne dobjuk el.
        const [c, m, y, kk] = numbers(4);
        fill = [(1 - c) * (1 - kk), (1 - m) * (1 - kk), (1 - y) * (1 - kk)];
        break;
      }
      case 're': {
        const [x, y, width, height] = numbers(4);
        pendingRects.push({ x, y, width, height });
        break;
      }
      case 'f':
      case 'F':
      case 'f*':
      case 'b':
      case 'b*':
      case 'B':
      case 'B*': {
        for (const rect of pendingRects) rects.push({ ...rect, color: [...fill] as [number, number, number] });
        pendingRects = [];
        break;
      }
      case 'n':
      case 'S':
      case 's':
        // Vágás vagy körvonal — a téglalapok nem kitöltöttek, eldobjuk őket.
        pendingRects = [];
        break;
      case 'BT':
        cursor = { x: 0, y: 0 };
        break;
      case 'ET':
        cursor = null;
        break;
      case 'Tm': {
        const values = numbers(6);
        cursor = { x: values[4], y: values[5] };
        break;
      }
      case 'Td':
      case 'TD': {
        const [dx, dy] = numbers(2);
        cursor = cursor ? { x: cursor.x + dx, y: cursor.y + dy } : { x: dx, y: dy };
        break;
      }
      case 'Tj':
      case 'TJ':
      case "'":
      case '"': {
        const operand = [...operands].reverse().find((o) => /^[[(<]/.test(o));
        const text = operand ? textFromOperand(operand) : '';
        if (cursor && text.trim() !== '') texts.push({ x: cursor.x, y: cursor.y, text });
        break;
      }
      default:
        break;
    }
    operands = [];
  }

  return { texts, rects };
}

/** A PDF oldalainak szöveg- és kitöltött-téglalap tartalma, oldalsorrendben. */
export function extractPages(pdf: Buffer): PdfPage[] {
  const latin = pdf.toString('latin1');
  const pageObjects = pageObjectNumbers(latin);
  if (pageObjects.length === 0) {
    throw new Error('A PDF oldalfája (/Pages /Kids) nem olvasható ki.');
  }

  const pages: PdfPage[] = [];
  pageObjects.forEach((pageObject, index) => {
    const contentObject = contentObjectNumber(latin, pageObject);
    if (contentObject === null) {
      pages.push({ index, texts: [], rects: [] });
      return;
    }
    const stream = readObjectStream(pdf, latin, contentObject);
    if (!stream) {
      pages.push({ index, texts: [], rects: [] });
      return;
    }
    const { texts, rects } = parseContentStream(stream.toString('latin1'));
    pages.push({ index, texts, rects });
  });

  return pages;
}

/** Igaz, ha két szín a megadott tűréssel megegyezik. */
export function colorMatches(
  color: readonly [number, number, number],
  target: readonly [number, number, number],
  tolerance = 0.08,
): boolean {
  return color.every((channel, i) => Math.abs(channel - target[i]) <= tolerance);
}

/** A pontot tartalmazó, LEGKISEBB területű kitöltött téglalap (a legfelső cella). */
export function rectAt(rects: PdfFilledRect[], x: number, y: number): PdfFilledRect | null {
  let best: PdfFilledRect | null = null;
  for (const rect of rects) {
    if (x < rect.x || x > rect.x + rect.width) continue;
    if (y < rect.y || y > rect.y + rect.height) continue;
    if (best === null || rect.width * rect.height < best.width * best.height) best = rect;
  }
  return best;
}
