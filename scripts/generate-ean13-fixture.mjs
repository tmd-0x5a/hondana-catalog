import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

const isbn = process.argv[2] || "9784101010014";
if (!/^\d{13}$/.test(isbn)) throw new Error("13桁のISBNを指定してください。");

let pattern = "101";
const parity = PARITY[Number(isbn[0])];
for (let index = 1; index <= 6; index += 1) {
  pattern += parity[index - 1] === "L" ? L[Number(isbn[index])] : G[Number(isbn[index])];
}
pattern += "01010";
for (let index = 7; index <= 12; index += 1) pattern += R[Number(isbn[index])];
pattern += "101";

const moduleWidth = 5;
const quietZone = 12;
const width = (pattern.length + quietZone * 2) * moduleWidth;
const bars = [...pattern]
  .map((bit, index) => bit === "1" ? `<rect x="${(index + quietZone) * moduleWidth}" y="18" width="${moduleWidth}" height="190"/>` : "")
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="250"><rect width="100%" height="100%" fill="white"/><g fill="black">${bars}</g><text x="50%" y="238" text-anchor="middle" font-family="Arial" font-size="24">${isbn}</text></svg>`;
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../qa/test-ean13.png");
await sharp(Buffer.from(svg)).png().toFile(output);
console.log(output);
