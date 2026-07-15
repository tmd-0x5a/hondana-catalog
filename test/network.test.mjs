import assert from "node:assert/strict";
import test from "node:test";

import { privateLanAddress } from "../server/network.mjs";

test("LANアドレスは192.168帯を他のプライベートIPv4より優先する", () => {
  const address = privateLanAddress({
    first: [{ family: "IPv4", internal: false, address: "10.0.0.8" }],
    second: [{ family: "IPv4", internal: false, address: "192.168.1.20" }],
  });

  assert.equal(address, "192.168.1.20");
});

test("利用可能なプライベートIPv4がなければlocalhostへ戻る", () => {
  const address = privateLanAddress({ loopback: [{ family: "IPv4", internal: true, address: "127.0.0.1" }] });
  assert.equal(address, "127.0.0.1");
});
