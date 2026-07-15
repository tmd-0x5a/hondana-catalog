import fsp from "node:fs/promises";

const testDirectory = new URL("./", import.meta.url);
const testFiles = (await fsp.readdir(testDirectory))
  .filter((filename) => filename.endsWith(".test.mjs") && filename !== "all.test.mjs")
  .sort();

for (const testFile of testFiles) await import(new URL(testFile, testDirectory));
