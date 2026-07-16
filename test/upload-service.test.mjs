import assert from "node:assert/strict";
import test from "node:test";

import { UploadService } from "../server/upload-service.mjs";

test("端末申告ISBNを画像保存前に検証する", async () => {
  let imagePrepared = false;
  const repository = {
    uploads: [],
    async readUploads() { return structuredClone(this.uploads); },
    async saveUploads(uploads) { this.uploads = structuredClone(uploads); },
    async updateUploads(mutator) {
      const uploads = structuredClone(this.uploads);
      const result = await mutator(uploads);
      this.uploads = uploads;
      return result;
    },
  };
  const service = new UploadService({
    repository,
    bookService: {},
    barcodeScanner: {},
    uploadDir: ".",
    prepareImage: async () => {
      imagePrepared = true;
      return { extension: ".jpg", buffer: Buffer.from("image") };
    },
  });

  await assert.rejects(
    () => service.receiveImage({ buffer: Buffer.from("fake"), originalname: "cover.jpg" }, "9780000000000"),
    { status: 400 },
  );
  assert.equal(imagePrepared, false);
  assert.deepEqual(repository.uploads, []);
});
