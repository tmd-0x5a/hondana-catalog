/**
 * ISBN入力からハイフンや空白を除き、検証に使う数字列へ揃える。
 * ISBN-10のチェック文字だけは大文字のXとして残す。
 */
export function stripIsbn(value = "") {
  return String(value).toUpperCase().replace(/[^0-9X]/g, "");
}

/** ISBN-10の重み付きチェックサムを検証する。 */
export function validIsbn10(value) {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  const sum = [...value].reduce((total, digit, index) => {
    const number = digit === "X" ? 10 : Number(digit);
    return total + number * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

/** ISBN-13の末尾チェックディジットを検証する。 */
export function validIsbn13(value) {
  if (!/^\d{13}$/.test(value)) return false;
  const sum = [...value.slice(0, 12)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

/**
 * APIと保存データで使うISBNを13桁へ正規化する。
 * ISBN-10は978接頭辞を付けてチェックディジットを再計算する。
 */
export function normalizeIsbn(value) {
  const compact = stripIsbn(value);
  if (compact.length === 13 && validIsbn13(compact)) return compact;
  if (compact.length === 10 && validIsbn10(compact)) {
    const firstTwelve = `978${compact.slice(0, 9)}`;
    const sum = [...firstTwelve].reduce(
      (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0,
    );
    return `${firstTwelve}${(10 - (sum % 10)) % 10}`;
  }
  throw Object.assign(new Error("正しいISBN-10またはISBN-13を入力してください。"), { status: 400 });
}
