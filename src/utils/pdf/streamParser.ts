// Pure JS FlateDecode & CMap Stream Parser (100% Workers V8 Isolate Compatible)

import { decompressSync } from 'fflate';

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
  for (let i = start; i <= bytes.length - seq.length; i++) {
    let found = true;
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
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
    const fontCMaps: Array<Map<string, string>> = [];
    for (const streamText of decompressedStreams) {
      const cmapMap = new Map<string, string>();
      const bfcharMatches = streamText.match(/beginbfchar([\s\S]*?)endbfchar/g) || [];
      for (const block of bfcharMatches) {
        const lines = block.split('\n');
        for (const line of lines) {
          const m = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
          if (m) {
            const srcHex = m[1].toUpperCase().padStart(2, '0');
            const codePoint = parseInt(m[2], 16);
            if (!isNaN(codePoint)) {
              cmapMap.set(srcHex, String.fromCharCode(codePoint));
            }
          }
        }
      }

      const bfrangeMatches = streamText.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
      for (const block of bfrangeMatches) {
        const lines = block.split('\n');
        for (const line of lines) {
          const m = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
          if (m) {
            const startHex = parseInt(m[1], 16);
            const endHex = parseInt(m[2], 16);
            let startCodePoint = parseInt(m[3], 16);
            for (let hex = startHex; hex <= endHex; hex++) {
              const srcHex = hex.toString(16).toUpperCase().padStart(2, '0');
              cmapMap.set(srcHex, String.fromCharCode(startCodePoint++));
            }
          }
        }
      }

      if (cmapMap.size > 0) {
        fontCMaps.push(cmapMap);
      }
    }

    // Step 2: Extract text using font-aware CMap mapping
    let fullDecodedText = '';
    if (fontCMaps.length > 0) {
      for (const streamText of decompressedStreams) {
        const fontBlocks = streamText.split(/\/(F\d+)\s+/);
        let currentCMap = fontCMaps[0];

        for (let i = 0; i < fontBlocks.length; i++) {
          const block = fontBlocks[i];
          if (/^F\d+$/.test(block)) {
            const fontNum = parseInt(block.substring(1), 10);
            if (fontNum === 1 && fontCMaps.length >= 2) {
              currentCMap = fontCMaps[1];
            } else if (fontNum === 2 && fontCMaps.length >= 1) {
              currentCMap = fontCMaps[0];
            }
            continue;
          }

          const tjMatches = block.match(/\[([\s\S]*?)\]\s*T[jJ]|<([0-9a-fA-F]+)>\s*T[jJ]|\(([^()]+)\)\s*T[jJ]/g) || [];
          for (const tj of tjMatches) {
            // 1. Extract Parenthesized ASCII strings: (LUU VAN THANH) Tj
            const parenMatches = tj.match(/\(([^()]+)\)/g) || [];
            for (const p of parenMatches) {
              const textStr = p.slice(1, -1);
              if (textStr && textStr.trim().length > 0) {
                fullDecodedText += textStr + ' ';
              }
            }

            // 2. Extract Hex strings: <004C00550055...> TJ
            const hexes = tj.match(/<([0-9a-fA-F]+)>/g) || [];
            for (const h of hexes) {
              const cleanHex = h.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
              
              if (cleanHex.length % 4 === 0 && cleanHex.length >= 4) {
                // UTF-16BE 4-hex encoding
                for (let k = 0; k < cleanHex.length; k += 4) {
                  const quad = cleanHex.substring(k, k + 4);
                  if (currentCMap && currentCMap.has(quad)) {
                    fullDecodedText += currentCMap.get(quad);
                  } else {
                    const code = parseInt(quad, 16);
                    if (code >= 32 && code <= 65533 && code !== 65534) {
                      fullDecodedText += String.fromCharCode(code);
                    }
                  }
                }
              } else {
                // 2-hex encoding
                for (let k = 0; k < cleanHex.length; k += 2) {
                  const pair = cleanHex.substring(k, k + 2);
                  if (currentCMap && currentCMap.has(pair)) {
                    fullDecodedText += currentCMap.get(pair);
                  } else {
                    const code = parseInt(pair, 16);
                    if (code >= 32 && code <= 126) {
                      fullDecodedText += String.fromCharCode(code);
                    }
                  }
                }
              }
            }
            fullDecodedText += ' ';
          }
        }
      }
    }

    let cleanCMapText = fullDecodedText.replace(/\s+/g, ' ').trim();
    cleanCMapText = cleanCMapText.replace(/\b([A-Za-z0-9])\s+(?=[A-Za-z0-9]\b)/g, '$1');

    if (cleanCMapText.length >= 20) {
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

    return cleanPrintableText(fallbackText);
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
