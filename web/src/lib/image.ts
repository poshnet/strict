// The launch form's picture: drawn onto white at 512 x 512 (cover crop) and uploaded as a PNG. The no-vamps fingerprint
// is the worker's dHash (worker/vamp.js), run here on the very same pixels so the copycat check can answer before
// anything is sent. Ported from betterlaunch.

export type Picture = { blob: Blob; preview: string; hash: string };

const load = (file: File) => new Promise<HTMLImageElement>((res, rej) => {
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => { URL.revokeObjectURL(url); res(im); };
  im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That file isn't an image we can read.")); };
  im.src = url;
});

function draw(im: HTMLImageElement, size: number) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  const s = Math.max(size / im.naturalWidth, size / im.naturalHeight);
  const w = im.naturalWidth * s, h = im.naturalHeight * s;
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, (size - w) / 2, (size - h) / 2, w, h);
  return { c, g };
}

// Same maths as the worker's dHash, cell for cell.
export function dHash(px: Uint8ClampedArray, w: number, h: number) {
  const cells: number[] = [];
  for (let cy = 0; cy < 8; cy++) {
    const y0 = Math.floor((cy * h) / 8), y1 = Math.floor(((cy + 1) * h) / 8);
    for (let cx = 0; cx < 9; cx++) {
      const x0 = Math.floor((cx * w) / 9), x1 = Math.floor(((cx + 1) * w) / 9);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const a = px[i + 3] / 255;
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          sum += lum * a + 255 * (1 - a);
        }
      }
      cells.push(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  let bits = 0n;
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) bits = (bits << 1n) | (cells[cy * 9 + cx] > cells[cy * 9 + cx + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

export async function preparePicture(file: File): Promise<Picture> {
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG, GIF or WEBP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Keep it under 8 MB.');
  const im = await load(file);
  const { c, g } = draw(im, 512);
  const hash = dHash(g.getImageData(0, 0, 512, 512).data, 512, 512);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("That picture couldn't be prepared."))), 'image/png'));
  if (blob.size > 4 * 1024 * 1024) throw new Error('That picture is too detailed to send. Try a simpler one.');
  return { blob, preview: URL.createObjectURL(blob), hash };
}
