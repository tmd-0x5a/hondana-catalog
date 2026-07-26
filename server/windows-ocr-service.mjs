import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { httpError } from "./http-error.mjs";
import { inspectUploadedImage, MAX_UPLOAD_PIXELS } from "./image-validator.mjs";

export const MAX_OCR_SCREENSHOTS = 12;
const execFileAsync = promisify(execFile);

function unpackedScriptPath() {
  const sourcePath = fileURLToPath(new URL("./windows-ocr.ps1", import.meta.url));
  return sourcePath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

async function runWindowsOcr(scriptPath, imagePath) {
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    imagePath,
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
  });
  const parsed = JSON.parse(stdout || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

function finiteCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= 0 ? Math.round(coordinate * 100) / 100 : null;
}

async function prepareOcrImage(buffer) {
  await inspectUploadedImage(buffer);
  const { data, info } = await sharp(buffer, {
    limitInputPixels: MAX_UPLOAD_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/**
 * PowerShell側のOCR結果を、旧形式の文字列を含めて安全な行オブジェクトへ揃える。
 *
 * @param {unknown} value PowerShellから返されたOCR行。
 * @returns {{text: string, x: number|null, y: number|null, width: number|null, height: number|null}|null} 正規化済みOCR行。
 */
export function normalizeOcrResultLine(value) {
  const source = /** @type {{text?: unknown, x?: unknown, y?: unknown, width?: unknown, height?: unknown}} */ (
    value && typeof value === "object" ? value : { text: value }
  );
  const text = String(source.text || "").trim().slice(0, 300);
  if (!text) return null;
  return {
    text,
    x: finiteCoordinate(source.x),
    y: finiteCoordinate(source.y),
    width: finiteCoordinate(source.width),
    height: finiteCoordinate(source.height),
  };
}

/** Windows内蔵OCRの呼び出しと一時画像のライフサイクルだけを担当する。 */
export class WindowsOcrService {
  /**
   * @param {object} [dependencies] テスト時に差し替えるOS環境と処理関数。
   * @param {NodeJS.Platform} [dependencies.platform] 実行OS。
   * @param {(buffer: Buffer) => Promise<{buffer: Buffer, width: number, height: number}>} [dependencies.prepareImage] 画像検査・再構築処理。
   * @param {(scriptPath: string, imagePath: string) => Promise<unknown[]>} [dependencies.runOcr] OCR実行処理。
   */
  constructor({
    platform = process.platform,
    prepareImage = prepareOcrImage,
    runOcr = runWindowsOcr,
  } = {}) {
    this.platform = platform;
    this.prepareImage = prepareImage;
    this.runOcr = runOcr;
    this.scriptPath = unpackedScriptPath();
  }

  /**
   * 検証済みスクリーンショットをWindows OCRへ渡し、画像内座標付きの行を返す。
   *
   * @param {Express.Multer.File[]} files Multerがメモリ上で受信した画像。
   * @returns {Promise<Array<{filename: string, width: number, height: number, lines: Array<{text: string, x: number|null, y: number|null, width: number|null, height: number|null}>}>>} OCR文書。
   */
  async recognize(files) {
    if (this.platform !== "win32") throw httpError(501, "スクリーンショット取り込みはWindows版で利用できます。");
    if (!Array.isArray(files) || files.length === 0) throw httpError(400, "スクリーンショットを選択してください。");
    if (files.length > MAX_OCR_SCREENSHOTS) throw httpError(400, `スクリーンショットは${MAX_OCR_SCREENSHOTS}枚まで選択できます。`);

    const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-ocr-"));
    try {
      const documents = [];
      for (let index = 0; index < files.length; index += 1) {
        const prepared = await this.prepareImage(files[index].buffer);
        const imagePath = path.join(temporaryDirectory, `screenshot-${index + 1}.png`);
        await fsp.writeFile(imagePath, prepared.buffer, { flag: "wx" });
        const lines = await this.runOcr(this.scriptPath, imagePath);
        documents.push({
          filename: String(files[index].originalname || `screenshot-${index + 1}`).slice(0, 200),
          width: Number(prepared.width) || 0,
          height: Number(prepared.height) || 0,
          lines: lines.map(normalizeOcrResultLine).filter(Boolean).slice(0, 200),
        });
      }
      return documents;
    } catch (error) {
      if (Number(error?.status) >= 400 && Number(error?.status) < 600) throw error;
      throw httpError(422, "画像の文字を読み取れませんでした。別のスクリーンショットを試してください。");
    } finally {
      await fsp.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
