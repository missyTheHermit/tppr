export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/ping") {
      const upstream = new URL(request.url);
      upstream.protocol = "https:";
      upstream.hostname = "tppr.online";
      upstream.port = "";

      const headers = new Headers(request.headers);
      headers.delete("host");

      return fetch(new Request(upstream.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: request.redirect,
        cf: request.cf,
      }));
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (
      assetResponse.status === 404 &&
      request.method === "GET" &&
      !url.pathname.split("/").pop()?.includes(".")
    ) {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }

    return assetResponse;
  },
};
