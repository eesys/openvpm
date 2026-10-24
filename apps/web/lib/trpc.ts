export async function trpc<T>(path: string, input?: unknown, method: "GET" | "POST" = "GET"): Promise<T> {
  const url =
    method === "GET"
      ? `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input ?? {}))}`
      : `/api/trpc/${path}`;
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
  const body = (await response.json()) as {
    result?: { data?: T };
    error?: { message?: string };
  };
  if (!response.ok || !body.result) {
    throw new Error(body.error?.message ?? "请求失败");
  }
  return body.result.data as T;
}
