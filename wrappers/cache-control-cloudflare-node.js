/**
 * OpenNext Cloudflare Worker 自定义 wrapper
 *
 * 目的：在 streamCreator.writeHeaders 阶段强制覆盖 SSR HTML 页的 cache-control，
 *       让 Cloudflare 的 **Workers Cache** 真正缓存 HTML。
 *
 * 背景：
 *   - Next.js 15 默认对动态 SSR 页发 `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`
 *   - middleware 里设置的 cache-control 会被 Next.js page handler 在 sendRenderResult 阶段覆盖
 *   - OpenNext 的 default `cloudflare-node` wrapper 在 writeHeaders 时构造最终 Response，
 *     这是 Next.js page handler 跑完后最后一次改 headers 的机会（唯一干净的修复点）
 *
 * 2026-09-08 重写（C1）：
 *   1. 开启 Workers Cache（wrangler.toml `[cache] enabled = true`）。注意：zone 级 Cache Rule
 *      对 Worker 生成的响应**完全无效**，必须用 Workers Cache（见 CF 文档）。
 *   2. 边缘 TTL 改用 `cloudflare-cdn-cache-control`：
 *      CF 文档明确 `s-maxage` 会**禁用** `stale-while-revalidate`（RFC 9111 §4.2.4），
 *      所以边缘用 `max-age` 才能让 SWR 生效；浏览器侧另用 `cache-control` 保持每次校验。
 *   3. **不再删除 `vary`**：Workers Cache 会按 `Vary` 分变体存储（CF 文档「Vary」一节），
 *      删掉它会让 RSC 响应和 HTML 文档响应落到同一个缓存条目 → 页面被污染。
 *   4. RSC / 预取请求（`RSC: 1` / `Next-Router-State-Tree` / `Next-Router-Prefetch`）
 *      显式 `no-store`，不占缓存，避免与文档请求互相污染。
 *
 * 行为：
 *   - GET / HEAD + path 匹配 /en /zh /ja（排除 /api）或 /sitemap.xml、/robots.txt：
 *     - 删除 Next 的 no-store 与 set-cookie（带 Set-Cookie 的响应会被 CF 强制 BYPASS）
 *     - 文档请求：`cache-control: public, max-age=0, must-revalidate`
 *                 + `cloudflare-cdn-cache-control: public, max-age=28800, stale-while-revalidate=86400`
 *     - RSC/预取请求：`cache-control: private, no-store`
 *   - 其他（/api、静态资源）不动
 *
 * 配置：open-next.config.ts 用 defineCloudflareConfig()（默认 wrapper 名 "cloudflare-node"），
 *       本文件由 prebuild:cf（scripts/copy-wrapper.mjs）覆盖
 *       node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js 后被打进产物。
 *
 * 自检（注意：必须用 GET 探测，HEAD 的旧行为曾被误判为"缓存没生效"）：
 *   curl -s -D - -o /dev/null https://<domain>/en | grep -i 'cache-control\|cdn-cache'
 */

import { Writable } from "node:stream";

// Response with null body status (101, 204, 205, or 304) cannot have a body.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** 边缘 TTL（Workers Cache 读取 cloudflare-cdn-cache-control，优先级最高） */
const EDGE_CACHE_CONTROL =
  "public, max-age=28800, stale-while-revalidate=86400";
/** 浏览器侧：每次回源校验，避免用户看到陈旧 HTML */
const BROWSER_CACHE_CONTROL = "public, max-age=0, must-revalidate";
/** 匹配 /en, /zh, /ja 及其下子路径（不带 api 前缀） */
const LOCALE_PATH_REGEX = /^\/(en|zh|ja)(\/|\?|$)/;
/** sitemap.xml / robots.txt 也需要走 CDN 缓存（否则 Googlebot 每次抓取都打 D1） */
const SITEMAP_PATH_REGEX = /^\/(sitemap\.xml|robots\.txt)$/;

const handler = async (handler, converter) =>
  async (request, env, ctx, abortSignal) => {
    globalThis.process = process;
    // Set the environment variables
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }
    const internalEvent = await converter.convertFrom(request);
    const url = new URL(request.url);
    const { promise: promiseResponse, resolve: resolveResponse } =
      Promise.withResolvers();
    // HEAD 也纳入：Workers Cache 里 GET/HEAD 共用同一缓存条目，HEAD 头保持一致
    // 便于用 `curl -I` 做自检（历史上因为只放行 GET，HEAD 探针误报"缓存没生效"）
    const isGetOrHead = request.method === "GET" || request.method === "HEAD";
    const isLocalePage = isGetOrHead && LOCALE_PATH_REGEX.test(url.pathname);
    const isSitemapPath = isGetOrHead && SITEMAP_PATH_REGEX.test(url.pathname);
    const isCacheablePage = isLocalePage || isSitemapPath;
    // RSC / 客户端预取请求与文档请求共用同一个 URL，必须与文档缓存隔离
    const isRscRequest =
      request.headers.get("rsc") === "1" ||
      request.headers.has("next-router-state-tree") ||
      request.headers.get("next-router-prefetch") === "1";
    const streamCreator = {
      writeHeaders(prelude) {
        const { statusCode, cookies, headers } = prelude;
        const responseHeaders = new Headers(headers);
        for (const cookie of cookies) {
          responseHeaders.append("Set-Cookie", cookie);
        }
        // TODO(vicb): this is a workaround to make PPR work with `wrangler dev`
        // See https://github.com/cloudflare/workers-sdk/issues/8004
        if (url.hostname === "localhost") {
          responseHeaders.set("Content-Encoding", "identity");
        }
        // === cache-control override ===
        // 覆盖对象：/en/zh/ja 页面 + /sitemap.xml /robots.txt
        // 背景（2026-08-07）：sitemap 没被 CDN 缓存，Googlebot 每抓一次都打 D1，
        //                   构造 13437 个 URL 对象时内存压力大，是 1102 主要复发源
        // 背景（2026-09-08）：HTML 同理 —— GSC 17,966 条「已发现 - 尚未编入索引」
        //                   就是抓取被限速的表现，根因是每次爬取都要 SSR + D1
        if (isCacheablePage) {
          responseHeaders.delete("set-cookie");
          responseHeaders.delete("cache-control");
          responseHeaders.delete("cloudflare-cdn-cache-control");
          if (isRscRequest) {
            // RSC/预取响应不进缓存（避免与文档请求互相污染）
            responseHeaders.set("Cache-Control", "private, no-store");
          } else {
            responseHeaders.set("Cache-Control", BROWSER_CACHE_CONTROL);
            responseHeaders.set(
              "Cloudflare-CDN-Cache-Control",
              EDGE_CACHE_CONTROL,
            );
          }
          // 注意：**不要**删除 vary —— Workers Cache 按 Vary 分变体存储，
          // 删掉它会让 RSC 响应和 HTML 响应落到同一个缓存条目。
        }
        // Optimize: skip ReadableStream creation for null body statuses
        if (NULL_BODY_STATUSES.has(statusCode)) {
          const response = new Response(null, {
            status: statusCode,
            headers: responseHeaders,
          });
          resolveResponse(response);
          // Return a no-op Writable that discards all data
          return new Writable({
            write(_chunk, _encoding, callback) {
              callback();
            },
          });
        }
        let controller;
        const readable = new ReadableStream({
          start(c) {
            controller = c;
          },
        });
        const response = new Response(readable, {
          status: statusCode,
          headers: responseHeaders,
        });
        resolveResponse(response);
        return new Writable({
          write(chunk, _encoding, callback) {
            try {
              controller.enqueue(chunk);
            } catch (e) {
              return callback(e);
            }
            callback();
          },
          final(callback) {
            controller.close();
            callback();
          },
          destroy(error, callback) {
            if (error) {
              controller.error(error);
            } else {
              try {
                controller.close();
              } catch {
                // Ignore "This ReadableStream is closed" error
              }
            }
            callback(error);
          },
        });
      },
      // This is for passing along the original abort signal from the initial Request you retrieve in your worker
      // Ensures that the response we pass to NextServer is aborted if the request is aborted
      // By doing this `request.signal.onabort` will work in route handlers
      abortSignal: abortSignal,
      // There is no need to retain the chunks that were pushed to the response stream.
      retainChunks: false,
    };
    ctx.waitUntil(
      handler(internalEvent, {
        streamCreator,
        waitUntil: ctx.waitUntil.bind(ctx),
      }),
    );
    return promiseResponse;
  };

export default {
  wrapper: handler,
  name: "cache-control-cloudflare-node",
  supportStreaming: true,
};
