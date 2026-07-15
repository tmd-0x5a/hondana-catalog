export async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "通信に失敗しました。");
    error.payload = data;
    error.status = response.status;
    throw error;
  }
  return data;
}
