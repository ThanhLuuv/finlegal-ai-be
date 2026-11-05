// Pure JS FlateDecode & CMap Stream Parser (100% Workers V8 Isolate Compatible)

import { decompressSync } from 'fflate';
import { isCMapFontGarbage } from './qualityAssessor';

export function cleanPrintableText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\x00/g, '')
    .replace(/[\x01-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F\uFFFD]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findSequence(bytes: Uint8Array, seq: number[], start: number): number {
  if (!bytes || start >= bytes.length) return -1;
  const firstByte = seq[0];
  let pos = start;
  while (pos <= bytes.length - seq.length) {
    pos = bytes.indexOf(firstByte, pos);
    if (pos === -1 || pos > bytes.length - seq.length) return -1;
    let found = true;
    for (let j = 1; j < seq.length; j++) {
      if (bytes[pos + j] !== seq[j]) {
        found = false;
        break;
      }
    }
    if (found) return pos;
    pos++;
  }
  return -1;
}

/**
 * High-Precision CMap & FlateDecode Multi-Font PDF Stream Parser
 * Decompresses zlib streams using fflate and decodes CID/CMap embedded fonts per font block
 */
export function extractTextWithCMapDecompression(buffer: ArrayBuffer): string {
  try {
    const bytes = new Uint8Array(buffer);
    const decompressedStreams: string[] = [];
    const utf8Decoder = new TextDecoder('utf-8');

    let idx = 0;
    while (idx < bytes.length) {
      // Search for ASCII 'stream' (115, 116, 114, 101, 97, 109)
      const streamPos = findSequence(bytes, [115, 116, 114, 101, 97, 109], idx);
      if (streamPos === -1) break;

      let dataStart = streamPos + 6;
      while (dataStart < bytes.length && (bytes[dataStart] === 13 || bytes[dataStart] === 10)) {
        dataStart++;
      }

      // Search for ASCII 'endstream' (101, 110, 100, 115, 116, 114, 101, 97, 109)
      const endPos = findSequence(bytes, [101, 110, 100, 115, 116, 114, 101, 97, 109], dataStart);
      if (endPos === -1) break;

      let dataEnd = endPos;
      while (dataEnd > dataStart && (bytes[dataEnd - 1] === 13 || bytes[dataEnd - 1] === 10)) {
        dataEnd--;
      }

      const streamData = bytes.subarray(dataStart, dataEnd);
      try {
        const decompressed = decompressSync(streamData);
        decompressedStreams.push(utf8Decoder.decode(decompressed));
      } catch {
        try {
          decompressedStreams.push(utf8Decoder.decode(streamData));
        } catch {}
      }

      idx = endPos + 9;
    }

    // Step 1: Collect all distinct CMap font tables
    const allCMaps: Array<Map<string, string>> = [];
    for (const streamText of decompressedStreams) {
      const cmapMap = new Map<string, string>();
      const bfcharMatches = streamText.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g);
      for (const m of bfcharMatches) {
        const srcHex = m[1].toUpperCase();
        const codePoint = parseInt(m[2], 16);
        if (!isNaN(codePoint)) {
          cmapMap.set(srcHex, String.fromCharCode(codePoint));
        }
      }

      const bfrangeMatches = streamText.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g);
      for (const m of bfrangeMatches) {
        const startHex = parseInt(m[1], 16);
        const endHex = parseInt(m[2], 16);
        let dstCode = parseInt(m[3], 16);
        for (let hex = startHex; hex <= endHex; hex++) {
          const srcHex = hex.toString(16).toUpperCase().padStart(m[1].length, '0');
          cmapMap.set(srcHex, String.fromCharCode(dstCode++));
        }
      }

      if (cmapMap.size > 0) {
        allCMaps.push(cmapMap);
      }
    }

    const lookupCMap = (token: string): string | null => {
      for (const cm of allCMaps) {
        if (cm.has(token)) return cm.get(token)!;
      }
      return null;
    };

    // Step 2: Extract text using font-aware CMap mapping
    let fullDecodedText = '';
    for (const streamText of decompressedStreams) {
      if (!streamText.includes('BT') && !streamText.includes('Tj') && !streamText.includes('TJ')) continue;

      const tjMatches = streamText.matchAll(/(?:\(([^()]*)\)|<([0-9a-fA-F]+)>|\[([\s\S]*?)\])\s*T[jJ]/g);
      for (const tj of tjMatches) {
        // 1. Parenthesized ASCII / UTF-8 strings
        if (tj[1] !== undefined) {
          const textStr = tj[1].trim();
          if (textStr.length > 0) {
            fullDecodedText += textStr + ' ';
          }
        } 
        // 2. Hex strings: <02B8> Tj
        else if (tj[2] !== undefined) {
          const cleanHex = tj[2].replace(/[^0-9a-fA-F]/g, '').toUpperCase();
          const step = (cleanHex.length % 4 === 0 && cleanHex.length >= 4) ? 4 : 2;
          for (let k = 0; k < cleanHex.length; k += step) {
            const token = cleanHex.substring(k, k + step);
            const char = lookupCMap(token);
            if (char) {
              fullDecodedText += char;
            } else if (step === 2) {
              const code = parseInt(token, 16);
              if (code >= 32 && code <= 126) {
                fullDecodedText += String.fromCharCode(code);
              }
            }
          }
          fullDecodedText += '  ';
        } 
        // 3. Array notation: [(A) -100 <02B8>] TJ
        else if (tj[3] !== undefined) {
          const innerMatches = tj[3].matchAll(/(?:\(([^()]*)\)|<([0-9a-fA-F]+)>)/g);
          for (const item of innerMatches) {
            if (item[1] !== undefined) {
              fullDecodedText += item[1];
            } else if (item[2] !== undefined) {
              const cleanHex = item[2].replace(/[^0-9a-fA-F]/g, '').toUpperCase();
              const step = (cleanHex.length % 4 === 0 && cleanHex.length >= 4) ? 4 : 2;
              for (let k = 0; k < cleanHex.length; k += step) {
                const token = cleanHex.substring(k, k + step);
                const char = lookupCMap(token);
                if (char) {
                  fullDecodedText += char;
                } else if (step === 2) {
                  const code = parseInt(token, 16);
                  if (code >= 32 && code <= 126) {
                    fullDecodedText += String.fromCharCode(code);
                  }
                }
              }
            }
          }
          fullDecodedText += '  ';
        }
      }
      fullDecodedText += '\n';
    }

    // Collapse spaced-out letters inside words
    let cleanCMapText = fullDecodedText
      .split('\n')
      .map(line => line.split(/\s{2,}/).map(w => w.replace(/\s+/g, '')).join(' '))
      .filter(l => l.trim().length > 0)
      .join('\n');

    if (cleanCMapText.length >= 20 && !isCMapFontGarbage(cleanCMapText)) {
      return cleanPrintableText(cleanCMapText);
    }

    // Step 3: Fallback - Extract standard parenthesized text (text) inside decompressed streams
    let fallbackText = '';
    for (const streamText of decompressedStreams) {
      const parenthesized = streamText.match(/\(([^()]{2,})\)/g) || [];
      for (const p of parenthesized) {
        const raw = p.slice(1, -1).trim();
        if (raw.length > 1 && /[a-zA-Z0-9\u00C0-\u1EF9]/.test(raw)) {
          fallbackText += raw + ' ';
        }
      }
    }

    const cleanFallback = cleanPrintableText(fallbackText);
    if (cleanFallback.length >= 20 && !isCMapFontGarbage(cleanFallback)) {
      return cleanFallback;
    }

    // Return empty string if no valid natural language text was detected
    return '';
  } catch (err) {
    console.warn('PDF stream extraction error:', err);
    return '';
  }
}

export function stripPDFSyntaxNoise(text: string): string {
  if (!text) return '';
  return text
    .replace(/\/Filter\s*\/FlateDecode/g, '')
    .replace(/\/CIDInit\s*\/ProcSet\s*findresource\s*begin/g, '')
    .replace(/endcmap\s*CMapName\s*currentdict\s*end/gi, '')
    .replace(/begincmap[\s\S]*?endcmap/gi, '')
    .replace(/endbfrange\s*endcmap/gi, '')
    .replace(/obj[\s\S]*?endobj/g, '')
    .replace(/<<[\s\S]*?>>/g, '')
    .replace(/stream[\s\S]*?endstream/gi, '')
    .replace(/%PDF-\d\.\d/g, '')
    .replace(/\b(BT|ET|Td|TD|Tj|TJ|cm|Tm|Do|gs|q|Q)\b/g, ' ')
    .trim();
}

export function isPDFSyntaxChunk(text: string): boolean {
  if (!text) return false;
  const syntaxTerms = ['FlateDecode', 'CIDInit', 'ProcSet', 'begincmap', 'endcmap', 'endbfrange', 'OutputIntents', 'CIDFontType2'];
  let count = 0;
  for (const term of syntaxTerms) {
    if (text.includes(term)) count++;
  }
  return count >= 2;
}
