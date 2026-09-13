const TELEGRAM_API = "https://api.telegram.org";
const METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);
const HOP_BY_HOP = new Set(["connection", "content-length", "host", "transfer-encoding"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    if (!METHODS.has(request.method)) return new Response("Method Not Allowed", { status: 405 });
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "edgechat-telegram-proxy" });
    }

    const secret = String(env.PROXY_SECRET || "").trim();
    if (!secret) return json({ ok: false, error: "proxy_not_configured" }, 503);
    if (request.headers.get("X-EdgeChat-Proxy-Secret") !== secret) {
      return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,X-EdgeChat-Proxy-Secret,X-EdgeChat-Telegram-Bot-Token",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const botToken = String(request.headers.get("X-EdgeChat-Telegram-Bot-Token") || "").trim();
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      return json({ ok: false, error: "invalid_bot_token" }, 400);
    }

    let targetPath;
    if (url.pathname.startsWith("/bot/")) {
      const method = decodeURIComponent(url.pathname.slice("/bot/".length));
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(method)) return new Response("Not Found", { status: 404 });
      targetPath = `/bot${botToken}/${method}`;
    } else if (url.pathname.startsWith("/file/")) {
      const filePath = url.pathname.slice("/file/".length).replace(/^\/+/, "");
      if (!filePath || filePath.includes("..") || filePath.includes("\\")) return new Response("Not Found", { status: 404 });
      targetPath = `/file/bot${botToken}/${filePath}`;
    } else if (/^\/bot\d+:[A-Za-z0-9_-]+\//.test(url.pathname)) {
      // Backward-compatible form for storage rows created before the proxy-aware backend tag.
      targetPath = url.pathname;
      const embeddedToken = targetPath.slice(4).split('/')[0];
      if (embeddedToken !== botToken) return new Response("Unauthorized", { status: 401 });
    } else if (url.pathname.startsWith("/file/bot")) {
      const embedded = url.pathname.slice("/file/bot".length);
      const slash = embedded.indexOf('/');
      const embeddedToken = slash >= 0 ? embedded.slice(0, slash) : embedded;
      if (embeddedToken !== botToken || !slash) return new Response("Unauthorized", { status: 401 });
      const filePath = embedded.slice(slash + 1);
      if (!filePath || filePath.includes("..") || filePath.includes("\\")) return new Response("Not Found", { status: 404 });
      targetPath = `/file/bot${botToken}/${filePath}`;
    } else {
      return new Response("Not Found", { status: 404 });
    }

    const headers = new Headers(request.headers);
    for (const name of HOP_BY_HOP) headers.delete(name);
    headers.delete("X-EdgeChat-Proxy-Secret");
    headers.delete("X-EdgeChat-Telegram-Bot-Token");
    headers.delete("origin");
    headers.delete("referer");

    const upstream = await fetch(new Request(`${TELEGRAM_API}${targetPath}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "follow",
    }));

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.delete("server");
    responseHeaders.set("cache-control", request.url.includes("/file/") ? "private, max-age=300" : "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};
