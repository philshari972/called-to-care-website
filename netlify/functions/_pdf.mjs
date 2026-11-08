// A very small PDF writer: one or more Letter-size pages, the built-in PDF fonts, lines, boxes, and JPEG images.
// No outside packages. Positions are in points (72 per inch), measured from the TOP-left corner of the page.
import { WIDTHS } from './_fontwidths.mjs';

export const PAGE_W = 612, PAGE_H = 792;
const FONTS = ['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-Bold', 'Times-Italic'];

// Unicode -> Windows-1252 (the encoding the built-in fonts use)
const CP = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
export function toWin(s) {
  const out = [];
  for (const ch of String(s ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (CP[c]) out.push(CP[c]);
    else if (c === 9) out.push(32);
    else if (c === 0x2009 || c === 0x202f || c === 0x00a0) out.push(32);
    else if (c > 32) out.push(63);   // "?" for anything the font can't show
  }
  return out;
}
const hex = (c) => { const n = parseInt(c.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' '); };
const num = (n) => (Math.round(n * 100) / 100).toString();

export function textWidth(s, font = 'Times-Roman', size = 11) {
  const w = WIDTHS[font]; let t = 0;
  for (const c of toWin(s)) t += w[c - 32] || 500;
  return (t * size) / 1000;
}
// Break text into lines that fit maxW (keeps words whole; hyphenates nothing).
export function wrap(s, font, size, maxW) {
  const lines = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || textWidth(next, font, size) <= maxW) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export class PDF {
  constructor() { this.pages = [[]]; this.images = []; }
  get ops() { return this.pages[this.pages.length - 1]; }
  addPage() { this.pages.push([]); }
  // Draw text with its baseline at y (from the top). align: left | right | center
  text(x, y, s, { font = 'Times-Roman', size = 11, color = '#2B3440', align = 'left', spacing = 0 } = {}) {
    const f = FONTS.indexOf(font); if (f < 0) throw new Error('Unknown font ' + font);
    const codes = toWin(s); if (!codes.length) return;
    let w = textWidth(s, font, size) + spacing * Math.max(codes.length - 1, 0);
    if (align === 'right') x -= w; else if (align === 'center') x -= w / 2;
    const str = codes.map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c))).join('');
    this.ops.push(`BT ${hex(color)} rg /F${f + 1} ${num(size)} Tf ${spacing ? num(spacing) + ' Tc ' : ''}${num(x)} ${num(PAGE_H - y)} Td (${str}) Tj ${spacing ? '0 Tc ' : ''}ET`);
  }
  line(x1, y1, x2, y2, { color = '#2B3440', width = 1 } = {}) {
    this.ops.push(`${hex(color)} RG ${num(width)} w ${num(x1)} ${num(PAGE_H - y1)} m ${num(x2)} ${num(PAGE_H - y2)} l S`);
  }
  rect(x, y, w, h, { fill = '#000000' } = {}) {
    this.ops.push(`${hex(fill)} rg ${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re f`);
  }
  circle(cx, cy, r, { fill = '#000000' } = {}) {
    const k = 0.5523 * r, y = PAGE_H - cy;
    this.ops.push(`${hex(fill)} rg ${num(cx + r)} ${num(y)} m ${num(cx + r)} ${num(y + k)} ${num(cx + k)} ${num(y + r)} ${num(cx)} ${num(y + r)} c `
      + `${num(cx - k)} ${num(y + r)} ${num(cx - r)} ${num(y + k)} ${num(cx - r)} ${num(y)} c ${num(cx - r)} ${num(y - k)} ${num(cx - k)} ${num(y - r)} ${num(cx)} ${num(y - r)} c `
      + `${num(cx + k)} ${num(y - r)} ${num(cx + r)} ${num(y - k)} ${num(cx + r)} ${num(y)} c f`);
  }
  // JPEG image (Buffer), top-left at (x, y)
  image(jpeg, pxW, pxH, x, y, w, h) {
    let i = this.images.findIndex((im) => im.data === jpeg);
    if (i < 0) { this.images.push({ data: jpeg, w: pxW, h: pxH }); i = this.images.length - 1; }
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(PAGE_H - y - h)} cm /Im${i + 1} Do Q`);
  }
  build({ title = '', author = '' } = {}) {
    const objs = [];   // each: Buffer or string body (without "n 0 obj")
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const fontIds = FONTS.map((f) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
    const imgIds = this.images.map((im) => add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`, 'latin1'),
      im.data, Buffer.from('\nendstream', 'latin1')])));
    const res = `<< /Font << ${fontIds.map((id, i) => `/F${i + 1} ${id} 0 R`).join(' ')} >>${imgIds.length ? ` /XObject << ${imgIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : ''} >>`;
    const pageIds = this.pages.map((ops) => {
      const content = Buffer.from(ops.join('\n'), 'latin1');
      const cid = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
      return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${res} /Contents ${cid} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const pdfStr = (s) => '(' + toWin(s).map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c))).join('') + ')';
    const info = add(`<< /Title ${pdfStr(title)} /Author ${pdfStr(author)} /Producer (wearecalledtocare.com) >>`);

    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = parts[0].length; const xref = [];
    objs.forEach((body, i) => {
      xref.push(offset);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(chunk); offset += chunk.length;
    });
    const table = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
      + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    parts.push(Buffer.from(table, 'latin1'));
    return Buffer.concat(parts);
  }
}
