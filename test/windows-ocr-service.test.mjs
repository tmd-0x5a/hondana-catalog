import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import { WindowsOcrService } from "../server/windows-ocr-service.mjs";

test("Windows OCRサービスは再構築画像だけを一時ファイルで処理する", async () => {
  const image = await sharp({ create: { width: 120, height: 160, channels: 3, background: "white" } }).jpeg().toBuffer();
  let temporaryImagePath = "";
  const service = new WindowsOcrService({
    platform: "win32",
    prepareImage: async () => ({ buffer: image }),
    runOcr: async (_scriptPath, imagePath) => {
      temporaryImagePath = imagePath;
      assert.equal((await sharp(imagePath).metadata()).format, "jpeg");
      return ["葬 送 の フ リ - レ ン"];
    },
  });

  const [document] = await service.recognize([{ originalname: "library.png", buffer: image }]);
  assert.deepEqual(document, { filename: "library.png", lines: ["葬 送 の フ リ - レ ン"] });
  await assert.rejects(() => fsp.access(temporaryImagePath));
});

test("Windows以外ではOCR画像を処理しない", async () => {
  const service = new WindowsOcrService({ platform: "linux" });
  await assert.rejects(() => service.recognize([{ buffer: Buffer.from("image") }]), { status: 501 });
});
