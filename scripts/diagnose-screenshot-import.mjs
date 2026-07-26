// スクショ取り込みの診断用。グリッド型の電子書店ライブラリ画面を合成し、
// 実際のWindows OCRとタイトル抽出を通して品質を確認する。
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { extractTitleQueries } from "../server/book-screenshot-import-service.mjs";
import { WindowsOcrService } from "../server/windows-ocr-service.mjs";

const BOOKS = [
  { title: "葬送のフリーレン 14", author: "山田鐘人", imprint: "少年サンデーコミックス", color: "#5b7d9a" },
  { title: "ダンダダン 12", author: "龍幸伸", imprint: "ジャンプコミックス", color: "#9a5b5b" },
  { title: "世界一流エンジニアの思考法", author: "牛尾剛", imprint: "文藝春秋", color: "#5b9a6e" },
  { title: "つくりながら学ぶ!LLM自作入門", author: "Sebastian Raschka", imprint: "マイナビ出版", color: "#8a789a" },
  { title: "転生したらスライムだった件 21", author: "伏瀬", imprint: "GCノベルズ", color: "#9a8a5b" },
  { title: "コンビニ人間", author: "村田沙耶香", imprint: "文春文庫", color: "#5b8a9a" },
];

function tile(book, column, row) {
  const x = 40 + column * 340;
  const y = 60 + row * 560;
  const titleLines = book.title.length > 10
    ? [book.title.slice(0, 10), book.title.slice(10)]
    : [book.title];
  return `
    <rect x="${x}" y="${y}" width="280" height="400" rx="6" fill="${book.color}" />
    ${titleLines.map((line, index) => `<text x="${x + 20}" y="${y + 70 + index * 44}" font-size="34" font-weight="bold" fill="#ffffff">${line}</text>`).join("")}
    <text x="${x + 20}" y="${y + 300}" font-size="24" fill="#f0f0f0">${book.author}</text>
    <text x="${x + 20}" y="${y + 370}" font-size="20" fill="#e0e0e0">${book.imprint}</text>
    <text x="${x}" y="${y + 440}" font-size="22" fill="#222222">${book.title}</text>
    <text x="${x}" y="${y + 472}" font-size="18" fill="#666666">${book.author}</text>
  `;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1240" font-family="Meiryo, sans-serif">
  <rect width="1080" height="1240" fill="#ffffff" />
  <text x="40" y="36" font-size="24" fill="#333333">ライブラリ 購入済み 並び替え</text>
  ${BOOKS.map((book, index) => tile(book, index % 3, Math.floor(index / 3))).join("")}
</svg>`;

const outDir = path.resolve("qa");
await fsp.mkdir(outDir, { recursive: true });
const pngPath = path.join(outDir, "synthetic-library.png");
await sharp(Buffer.from(svg)).png().toFile(pngPath);
console.log("生成:", pngPath);

const ocrService = new WindowsOcrService();
const buffer = await fsp.readFile(pngPath);
const documents = await ocrService.recognize([{ originalname: "synthetic-library.png", buffer }]);
console.log("\n--- OCR行 (", documents[0].lines.length, "行) ---");
for (const line of documents[0].lines) {
  console.log(`(${Math.round(line.x)},${Math.round(line.y)}) h=${Math.round(line.height)} : ${line.text}`);
}

console.log("\n--- 抽出された検索語 ---");
for (const query of extractTitleQueries(documents)) console.log("*", query);
console.log("\n期待値:", BOOKS.map((book) => book.title).join(" / "));
