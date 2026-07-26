import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import { WindowsOcrService } from "../server/windows-ocr-service.mjs";

test("Windows OCRサービスは座標付きOCR行と画像サイズを返す", async () => {
  const image = await sharp({ create: { width: 120, height: 160, channels: 3, background: "white" } }).png().toBuffer();
  let temporaryImagePath = "";
  const service = new WindowsOcrService({
    platform: "win32",
    prepareImage: async () => ({ buffer: image, width: 120, height: 160 }),
    runOcr: async (_scriptPath, imagePath) => {
      temporaryImagePath = imagePath;
      assert.equal((await sharp(imagePath).metadata()).format, "png");
      return [{ text: "葬 送 の フ リ - レ ン", x: 10, y: 20, width: 90, height: 18 }];
    },
  });

  const [document] = await service.recognize([{ originalname: "library.png", buffer: image }]);
  assert.deepEqual(document, {
    filename: "library.png",
    width: 120,
    height: 160,
    lines: [{ text: "葬 送 の フ リ - レ ン", x: 10, y: 20, width: 90, height: 18 }],
  });
  await assert.rejects(() => fsp.access(temporaryImagePath));
});

test("旧OCR形式の文字列も座標なしの行として扱う", async () => {
  const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  const service = new WindowsOcrService({
    platform: "win32",
    prepareImage: async () => ({ buffer: image }),
    runOcr: async () => ["既存形式の書名"],
  });

  const [document] = await service.recognize([{ originalname: "legacy.png", buffer: image }]);
  assert.deepEqual(document.lines, [{ text: "既存形式の書名", x: null, y: null, width: null, height: null }]);
});

test("Windows以外ではOCR画像を処理しない", async () => {
  const service = new WindowsOcrService({ platform: "linux" });
  await assert.rejects(() => service.recognize([{ buffer: Buffer.from("image") }]), { status: 501 });
});
