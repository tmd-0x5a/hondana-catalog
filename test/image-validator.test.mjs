import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { inspectUploadedImage, prepareUploadedImage } from "../server/image-validator.mjs";

test("画像実体から形式を判定し、偽装データを拒否する", async () => {
  const jpeg = await sharp({
    create: { width: 120, height: 160, channels: 3, background: "white" },
  }).jpeg().toBuffer();
  const inspected = await inspectUploadedImage(jpeg);
  assert.equal(inspected.format, "jpeg");
  assert.equal(inspected.extension, ".jpg");
  const prepared = await prepareUploadedImage(jpeg);
  assert.equal(prepared.format, "jpeg");
  assert.equal((await sharp(prepared.buffer).metadata()).orientation, undefined);

  await assert.rejects(() => inspectUploadedImage(Buffer.from("not an image")), { status: 400 });
});
