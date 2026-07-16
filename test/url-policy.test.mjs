import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedExternalUrl,
  isApplicationUrl,
  isLocalCompanionPage,
} from "../electron/url-policy.mjs";

test("Electronの画面遷移は同一オリジンとLAN補助画面だけをアプリ内で許可する", () => {
  const appUrl = "http://127.0.0.1:8080";
  assert.equal(isApplicationUrl("http://127.0.0.1:8080/check", appUrl), true);
  assert.equal(isApplicationUrl("http://127.0.0.1:8080@attacker.example/check", appUrl), false);
  assert.equal(isLocalCompanionPage("http://192.168.1.20:8080/upload?access_token=x", appUrl), true);
  assert.equal(isLocalCompanionPage("http://attacker.example:8080/upload", appUrl), false);
});

test("OSブラウザへ渡すURLは認証情報なしHTTPSだけを許可する", () => {
  assert.equal(isAllowedExternalUrl("https://book.example/item/1"), true);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("file:///C:/Windows/system.ini"), false);
  assert.equal(isAllowedExternalUrl("https://user:pass@example.com/"), false);
});
