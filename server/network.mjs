import os from "node:os";

function isPrivateIpv4(address) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}

/**
 * iPhoneから到達しやすいプライベートIPv4を、家庭LANで一般的な順に選ぶ。
 *
 * @param {NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>} [networkInterfaces] テスト差し替え用インターフェース一覧。
 * @returns {string} 優先LAN IPv4。見つからない場合は127.0.0.1。
 */
export function privateLanAddress(networkInterfaces = os.networkInterfaces()) {
  const candidates = Object.values(networkInterfaces)
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter(isPrivateIpv4);

  return candidates.find((address) => address.startsWith("192.168."))
    || candidates.find((address) => address.startsWith("10."))
    || candidates[0]
    || "127.0.0.1";
}
