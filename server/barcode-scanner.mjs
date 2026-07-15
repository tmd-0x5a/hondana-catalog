import ZXing from "@zxing/library";
import sharp from "sharp";

import { stripIsbn, validIsbn13 } from "./isbn.mjs";

const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} = ZXing;

function barcodeRegions(width, height) {
  const region = (topRatio, heightRatio, name) => ({
    left: 0,
    top: Math.max(0, Math.floor(height * topRatio)),
    width,
    height: Math.min(height - Math.floor(height * topRatio), Math.floor(height * heightRatio)),
    name,
  });

  return [
    region(0, 1, "full"),
    region(0, 0.52, "top-half"),
    region(0.48, 0.52, "bottom-half"),
    region(0.08, 0.38, "upper-band"),
    region(0.31, 0.38, "middle-band"),
    region(0.56, 0.38, "lower-band"),
  ].filter((item) => item.width > 80 && item.height > 80);
}

function decodePixels(data, width, height, hints) {
  for (const Binarizer of [HybridBinarizer, GlobalHistogramBinarizer]) {
    try {
      const source = new RGBLuminanceSource(new Uint8ClampedArray(data), width, height);
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      return reader.decodeWithState(new BinaryBitmap(new Binarizer(source))).getText();
    } catch {
      // 照明むらでは二値化方式ごとに成否が変わるため、もう一方を続けて試す。
    }
  }
  return "";
}

function isbnFromBarcodeText(value) {
  const compact = stripIsbn(value);
  const hasBookPrefix = compact.startsWith("978") || compact.startsWith("979");
  return validIsbn13(compact) && hasBookPrefix ? compact : "";
}

/** 画像の向き補正、段階的な領域探索、ZXingによるISBN検証を担当する。 */
export class BarcodeScanner {
  constructor() {
    this.hints = new Map();
    this.hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
    ]);
    this.hints.set(DecodeHintType.TRY_HARDER, true);
  }

  async scan(buffer) {
    const { data: orientedImage, info } = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
    const regions = barcodeRegions(info.width, info.height);

    const fastPassRegions = ["bottom-half", "middle-band", "full"]
      .map((name) => regions.find((region) => region.name === name))
      .filter(Boolean);
    const fastResult = await this.#scanPass(orientedImage, fastPassRegions, [0, 180], 1400, false);
    if (fastResult) return fastResult;

    const thoroughResult = await this.#scanPass(orientedImage, regions, [0, 180, 90, 270], 2200, true);
    if (thoroughResult) return thoroughResult;

    throw Object.assign(
      new Error("ISBNバーコードを読み取れませんでした。バーコードを大きく、明るく撮影するかISBNを入力してください。"),
      { status: 422 },
    );
  }

  async #scanPass(image, regions, angles, maxSize, sharpenImage) {
    for (const region of regions) {
      for (const angle of angles) {
        try {
          const isbn = await this.#scanRegion(image, region, angle, maxSize, sharpenImage);
          if (isbn) return isbn;
        } catch {
          // 一つの切り出し失敗は想定内なので、次の領域と向きへ進む。
        }
      }
    }
    return "";
  }

  async #scanRegion(image, region, angle, maxSize, sharpenImage) {
    let pipeline = sharp(image)
      .extract({ left: region.left, top: region.top, width: region.width, height: region.height })
      .rotate(angle)
      .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: false })
      .greyscale()
      .normalize();
    if (sharpenImage) pipeline = pipeline.sharpen({ sigma: 0.8 });

    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    return isbnFromBarcodeText(decodePixels(data, info.width, info.height, this.hints));
  }
}
