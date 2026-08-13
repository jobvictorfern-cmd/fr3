/**
 * Leitura e escrita do `Picture.PropData` do TfrxPictureView.
 *
 * O FastReport grava a imagem como um stream de propriedade do Delphi em
 * hexadecimal:
 *
 *   04 "Data" 0A <len:4> 07 "TBitmap" <len:4> <bytes da imagem>
 *
 * Em vez de reimplementar o formato do stream, localizamos a assinatura da
 * imagem (BM / PNG / JPEG) dentro do blob e usamos o resto — funciona para os
 * arquivos gerados pelo FastReport e degrada de forma previsivel.
 */

const SIGNATURES = [
  { hex: '424d', mime: 'image/bmp' },
  { hex: '89504e470d0a1a0a', mime: 'image/png' },
  { hex: 'ffd8ff', mime: 'image/jpeg' },
  { hex: '47494638', mime: 'image/gif' },
];

function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0').toUpperCase();
  return out;
}

function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

/**
 * Extrai a imagem embutida no PropData.
 * @returns {{mime:string, bytes:Uint8Array}|null}
 */
export function decodePropData(propData) {
  if (!propData) return null;
  const hex = propData.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  let best = null;
  for (const sig of SIGNATURES) {
    const at = hex.indexOf(sig.hex);
    if (at !== -1 && at % 2 === 0 && (best === null || at < best.at)) {
      best = { at, sig };
    }
  }
  if (!best) return null;

  let slice = hex.slice(best.at);
  const bytes = hexToBytes(slice);
  if (best.sig.mime === 'image/bmp' && bytes.length >= 6) {
    // O header BMP traz o tamanho real; o stream pode ter bytes extras depois.
    const size = bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24);
    if (size > 0 && size <= bytes.length) {
      return { mime: 'image/bmp', bytes: bytes.subarray(0, size) };
    }
  }
  return { mime: best.sig.mime, bytes };
}

/** PropData -> `data:` URL pronta para um `<img>`. */
export function propDataToDataUrl(propData) {
  const image = decodePropData(propData);
  if (!image) return null;
  return `data:${image.mime};base64,${bytesToBase64(image.bytes)}`;
}

function delphiString(text) {
  return bytesToHex([text.length]) + bytesToHex([...text].map((c) => c.charCodeAt(0)));
}

function uint32(value) {
  return bytesToHex([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]);
}

/**
 * Monta um PropData equivalente ao do FastReport a partir de um BMP.
 * Usamos sempre TBitmap: e a classe suportada por qualquer versao do
 * FastReport VCL, entao a imagem continua abrindo no designer original.
 */
export function bmpToPropData(bmpBytes) {
  const payload = delphiString('TBitmap') + uint32(bmpBytes.length) + bytesToHex(bmpBytes);
  const inner = payload.length / 2;
  return delphiString('Data') + '0A' + uint32(inner) + payload;
}

/**
 * Codifica um `ImageData` (RGBA) como BMP 24 bits bottom-up.
 * Usado para converter PNG/JPG escolhidos pelo usuario em algo que o
 * FastReport consiga abrir.
 */
export function imageDataToBmp(imageData) {
  const { width, height, data } = imageData;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);

  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const alpha = data[i + 3] / 255;
      // Achata sobre branco: BMP 24 bits nao tem canal alfa.
      out[dst++] = Math.round(data[i + 2] * alpha + 255 * (1 - alpha));
      out[dst++] = Math.round(data[i + 1] * alpha + 255 * (1 - alpha));
      out[dst++] = Math.round(data[i] * alpha + 255 * (1 - alpha));
    }
  }
  return out;
}
