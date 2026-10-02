import { describe, expect, it } from 'vitest';
import { cleanFileName, sniffPortalFile } from '../src/pipeline/documents.ts';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p)));
const ZIP = [0x50, 0x4b, 0x03, 0x04];

describe('portal file types (M5.3a): bytes decide, never the name', () => {
  it('recognizes PDF, PowerPoint, Word and the photo types', () => {
    expect(sniffPortalFile(bytes('%PDF-1.7\n...'))).toBe('pdf');
    expect(sniffPortalFile(bytes(ZIP, '....[Content_Types].xml....ppt/presentation.xml'))).toBe('pptx');
    expect(sniffPortalFile(bytes(ZIP, '[Content_Types].xml word/document.xml'))).toBe('docx');
    expect(sniffPortalFile(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffPortalFile(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffPortalFile(bytes('RIFF1234WEBPVP8 '))).toBe('webp');
  });

  it('refuses anything else: text, HTML, SVG, a plain ZIP, an Excel file', () => {
    expect(sniffPortalFile(bytes('hello'))).toBeNull();
    expect(sniffPortalFile(bytes('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffPortalFile(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffPortalFile(bytes(ZIP, 'evil.exe'))).toBeNull();
    expect(sniffPortalFile(bytes(ZIP, '[Content_Types].xml xl/workbook.xml'))).toBeNull();
    expect(sniffPortalFile(new Uint8Array())).toBeNull();
  });

  it('cleans file names and uses the sniffed type’s extension', () => {
    expect(cleanFileName('C:\\Users\\ana\\My talk.PDF', 'pdf')).toBe('My talk.pdf');
    expect(cleanFileName('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(cleanFileName('slides.exe', 'pptx')).toBe('slides.pptx');
    expect(cleanFileName('a"b<c>\u0000d.docx', 'docx')).toBe('abcd.docx');
    expect(cleanFileName('', 'png')).toBe('file.png');
    expect(cleanFileName(`${'x'.repeat(300)}.pdf`, 'pdf')).toHaveLength(124);
  });
});
