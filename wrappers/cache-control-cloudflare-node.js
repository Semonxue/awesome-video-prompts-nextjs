/**
 * OpenNext Cloudflare Worker 自定义 wrapper
 *
 * 目的：在 streamCreator.writeHeaders 阶段强制覆盖 SSR HTML 页的 cache-control
 *
 * 背景：
 *   - Next.js 15 默认对 SSR 页面发 `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`
 *   - 即使 middleware 设置了 `s-maxage=3600`，Next.js page handler 在 sendRenderResult 阶段也会覆盖
 *   - OpenNext 的 default `cloudflare-node` wrapper 在 writeHeaders 时构造 Response，
 *     这是 Next.js page handler 跑完后最后一次修改 headers 的机会
 *   - 所以在 wrapper 层 override 是唯一干净的方案
 *
 * 行为：
 *   - GET 请求 + path 以 /en /zh /ja 开头（排除 /api）：
 *     - 删除默认 cache-control（no-store）
 *     - 删除可能存在的 set-cookie
 *     - 设置 `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
 *   - 其他不动（API / static assets 保持默认）
 *
 * 配置：open-next.config.ts → override.wrapper = "cache-control-cloudflare-node"
 *       此文件由 build:cf prebuild 脚本从 ./wrappers/cache-control-cloudflare-node.js 复制到
 *       node_modules/@opennextjs/aws/dist/overrides/wrappers/，让 OpenNext esbuild 能 bundle
 */

import { Writable } from "node:stream";

// Response with null body status (101, 204, 205, or 304) cannot have a body.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
const CDN_CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=86400";
// 匹配 /en, /zh, /ja 及其下子路径（不带 api 前缀）
const LOCALE_PATH_REGEX = /^\/(en|zh|ja)(\/|\?|$)/;

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
    const isLocalePage =
      request.method === "GET" && LOCALE_PATH_REGEX.test(url.pathname);
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
        // === cache-control override（P0 #0.1 修复） ===
        if (isLocalePage) {
          responseHeaders.delete("cache-control");
          responseHeaders.delete("set-cookie");
          responseHeaders.set("Cache-Control", CDN_CACHE_CONTROL);
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
