import path from "node:path";
import { fileURLToPath } from "node:url";

import { sampleBooks } from "../src/sampleBooks.js";
import { createApp } from "./app.mjs";
import { BarcodeScanner } from "./barcode-scanner.mjs";
import { BookMetadataService } from "./book-metadata-service.mjs";
import { BookService } from "./book-service.mjs";
import { CoverService } from "./cover-service.mjs";
import { HttpClient } from "./http-client.mjs";
import { LibraryRepository } from "./library-repository.mjs";
import { NdlCatalogService } from "./ndl-catalog-service.mjs";
import { privateLanAddress } from "./network.mjs";
import { createBookRouter } from "./routes/book-router.mjs";
import { createSeriesRouter } from "./routes/series-router.mjs";
import { createSystemRouter } from "./routes/system-router.mjs";
import { createUploadRouter } from "./routes/upload-router.mjs";
import { SeriesService } from "./series-service.mjs";
import { UploadService } from "./upload-service.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.HONDANA_DIST_DIR || path.join(rootDir, "dist");
const dataDir = process.env.HONDANA_DATA_DIR || path.join(rootDir, "data");
const port = Number(process.env.PORT || 8080);

// Composition Rootとして依存の組立だけを行い、各サービスを単独でテスト可能に保つ。
const repository = new LibraryRepository({ dataDir, seedBooks: sampleBooks });
await repository.initialize();

const httpClient = new HttpClient();
const coverService = new CoverService({ coverDir: repository.paths.coverDir, httpClient });
const metadataService = new BookMetadataService({ httpClient, coverService });
const catalogService = new NdlCatalogService({ httpClient });
const barcodeScanner = new BarcodeScanner();
const bookService = new BookService({ repository, metadataService, coverService });
const seriesService = new SeriesService({ repository, catalogService });
const uploadService = new UploadService({
  repository,
  bookService,
  barcodeScanner,
  uploadDir: repository.paths.uploadDir,
});
await bookService.migrateStoredBooks();

const routers = [
  createSystemRouter({ bookService, port, getLanAddress: privateLanAddress }),
  createBookRouter({ bookService, catalogService }),
  createSeriesRouter({ seriesService }),
  createUploadRouter({ uploadService }),
];
const app = createApp({
  distDir,
  uploadDir: repository.paths.uploadDir,
  coverDir: repository.paths.coverDir,
  routers,
});

const server = app.listen(port, "0.0.0.0", () => {
  const lanUrl = `http://${privateLanAddress()}:${port}`;
  console.log(`本棚カタログ: http://127.0.0.1:${port}`);
  console.log(`iPhoneアップロード: ${lanUrl}/upload`);
  void bookService.backfillMissingCovers().catch((error) => {
    console.error("表紙の自動取得に失敗しました。", error);
  });
});

export { app, server };
