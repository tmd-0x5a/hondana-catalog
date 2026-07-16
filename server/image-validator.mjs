import sharp from "sharp";

import { httpError } from "./http-error.mjs";

/** HTTP受信と画像検査で共有する最大ファイルサイズ。 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** デコード前にSharpへ渡す最大入力画素数。 */
export const MAX_UPLOAD_PIXELS = 40_000_000;

const EXTENSION_BY_FORMAT = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  heif: ".heic",
};

/**
 * アップロード画像を実データから解析し、偽装MIME・巨大画像・動画化画像を拒否する。
 *
 * @param {Buffer} buffer Multerが受け取った画像バイト列。
 * @returns {Promise<{format: string, extension: string, width: number, height: number}>} 保存に使う検証済み画像情報。
 * @throws {Error & {status: number}} 対応外形式または処理量上限を超える画像の場合。
 */
export async function inspectUploadedImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw httpError(400, "画像は12MB以内で指定してください。");
  }

  try {
    const metadata = await sharp(buffer, {
      limitInputPixels: MAX_UPLOAD_PIXELS,
      sequentialRead: true,
    }).metadata();
    const extension = EXTENSION_BY_FORMAT[metadata.format];
    const width = Number(metadata.width) || 0;
    const height = Number(metadata.height) || 0;
    if (!extension || width < 80 || height < 80 || width * height > MAX_UPLOAD_PIXELS) {
      throw new Error("unsupported image");
    }
    if (Number(metadata.pages || 1) !== 1) throw new Error("animated image");
    return { format: metadata.format, extension, width, height };
  } catch {
    throw httpError(400, "JPEG、PNG、WebP、HEICの静止画像を選択してください。");
  }
}

/**
 * 検証済み画像を最大3200pxのJPEGへ再構築し、EXIFと付加ペイロードを保存前に除去する。
 *
 * @param {Buffer} buffer Multerが受け取った画像バイト列。
 * @returns {Promise<{format: "jpeg", extension: ".jpg", width: number, height: number, buffer: Buffer}>} 保存・解析用画像。
 */
export async function prepareUploadedImage(buffer) {
  await inspectUploadedImage(buffer);
  const { data, info } = await sharp(buffer, {
    limitInputPixels: MAX_UPLOAD_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width: 3200, height: 3200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    format: "jpeg",
    extension: ".jpg",
    width: info.width,
    height: info.height,
    buffer: data,
  };
}
