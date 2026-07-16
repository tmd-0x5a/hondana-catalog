import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { httpError } from "./http-error.mjs";
import { prepareUploadedImage } from "./image-validator.mjs";

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

/** Windows内蔵OCRの呼び出しと一時画像のライフサイクルだけを担当する。 */
export class WindowsOcrService {
  /**
   * @param {object} [dependencies] テスト時に差し替えるOS境界。
   * @param {NodeJS.Platform} [dependencies.platform] 実行OS。
   * @param {(buffer: Buffer) => Promise<object>} [dependencies.prepareImage] 画像検査・再構築処理。
   * @param {(scriptPath: string, imagePath: string) => Promise<string[]>} [dependencies.runOcr] OCR実行処理。
   */
  constructor({
    platform = process.platform,
    prepareImage = prepareUploadedImage,
    runOcr = runWindowsOcr,
  } = {}) {
    this.platform = platform;
    this.prepareImage = prepareImage;
    this.runOcr = runOcr;
    this.scriptPath = unpackedScriptPath();
  }

  /**
   * 検証済みスクリーンショットをWindows OCRへ渡し、画像単位の行を返す。
   *
   * @param {Express.Multer.File[]} files Multerがメモリ上で受信した画像。
   * @returns {Promise<Array<{filename: string, lines: string[]}>>} OCR行。
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
        // Windows OCRの最大寸法を下回るJPEGに統一し、端末由来の付加情報も残さない。
        const ocrBuffer = await sharp(prepared.buffer)
          .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
        const imagePath = path.join(temporaryDirectory, `screenshot-${index + 1}.jpg`);
        await fsp.writeFile(imagePath, ocrBuffer, { flag: "wx" });
        const lines = await this.runOcr(this.scriptPath, imagePath);
        documents.push({
          filename: String(files[index].originalname || `screenshot-${index + 1}`).slice(0, 200),
          lines: lines.map((line) => String(line || "").slice(0, 300)).filter(Boolean).slice(0, 200),
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
