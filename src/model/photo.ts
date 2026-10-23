/**
 * Turns an uploaded image into a small square JPEG data URL. Photos are kept
 * inside the person record, so they must stay small: about 10–20 KB each keeps
 * thousands of people within browser storage and sync payload limits.
 */

export const PHOTO_SIZE = 256;
export const MAX_PHOTO_LENGTH = 300_000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function photoFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Ez nem képfájl. Válassz JPG, PNG vagy más képet.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('A kép túl nagy (legfeljebb 25 MB lehet).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('A képet nem sikerült beolvasni. Próbáld JPG vagy PNG formátumban.');
  }
  // Centre-crop to a square, then scale down.
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_PHOTO_LENGTH) return url;
  }
  throw new Error('A képet nem sikerült elég kicsire tömöríteni.');
}

export const isPhotoDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_PHOTO_LENGTH && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
