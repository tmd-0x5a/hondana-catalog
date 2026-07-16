import assert from "node:assert/strict";
import test from "node:test";

import { createLanAccessGuard, isTrustedNetworkAddress } from "../server/security/access-control.mjs";
import { createOriginGuard } from "../server/security/http-security.mjs";
import { FixedWindowRateLimiter } from "../server/security/rate-limiter.mjs";

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    set(name, value) {
      if (typeof name === "object") Object.assign(this.headers, name);
      else this.headers[name] = value;
      return this;
    },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    type() { return this; },
    send(value) { this.body = value; return this; },
    cookie(name, value, options) { this.cookieValue = { name, value, options }; return this; },
    redirect(status, location) { this.statusCode = status; this.location = location; return this; },
  };
}

test("LANアクセスはHostと起動時トークンを検査してCookieへ移す", () => {
  const accessToken = "a".repeat(64);
  const guard = createLanAccessGuard({ accessToken, allowedHosts: ["192.168.1.20"] });
  const request = {
    method: "GET",
    path: "/upload",
    originalUrl: `/upload?access_token=${accessToken}`,
    headers: { host: "192.168.1.20:8080" },
    socket: { remoteAddress: "192.168.1.5" },
  };
  const response = mockResponse();
  guard(request, response, () => { throw new Error("redirect expected"); });
  assert.equal(response.statusCode, 303);
  assert.equal(response.location, "/upload");
  assert.equal(response.cookieValue.options.httpOnly, true);
  assert.equal(response.cookieValue.options.sameSite, "strict");

  const authorized = {
    ...request,
    originalUrl: "/api/books",
    path: "/api/books",
    headers: { ...request.headers, cookie: `hondana_access=${accessToken}` },
  };
  let passed = false;
  guard(authorized, mockResponse(), () => { passed = true; });
  assert.equal(passed, true);
});

test("公開IP、未知Host、外部Origin、過剰要求を拒否する", () => {
  assert.equal(isTrustedNetworkAddress("8.8.8.8"), false);
  assert.equal(isTrustedNetworkAddress("::ffff:192.168.1.4"), true);

  const token = "b".repeat(64);
  const guard = createLanAccessGuard({ accessToken: token, allowedHosts: ["192.168.1.20"] });
  const response = mockResponse();
  guard({
    method: "GET",
    path: "/api/books",
    originalUrl: "/api/books",
    headers: { host: "attacker.example" },
    socket: { remoteAddress: "192.168.1.5" },
  }, response, () => {});
  assert.equal(response.statusCode, 403);

  const originResponse = mockResponse();
  createOriginGuard(["http://192.168.1.20:8080"])({
    method: "POST",
    headers: { origin: "https://attacker.example" },
  }, originResponse, () => {});
  assert.equal(originResponse.statusCode, 403);

  const limiter = new FixedWindowRateLimiter({ maxRequests: 1, now: () => 1000 });
  const middleware = limiter.middleware();
  const rateRequest = { socket: { remoteAddress: "192.168.1.5" } };
  middleware(rateRequest, mockResponse(), () => {});
  const limitedResponse = mockResponse();
  middleware(rateRequest, limitedResponse, () => {});
  assert.equal(limitedResponse.statusCode, 429);
});
