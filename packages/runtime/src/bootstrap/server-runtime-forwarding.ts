import type { ServerRuntimePolicy } from "./server-runtime-policy";

export const RUNTIME_INTERNAL_TOKEN_HEADER = "x-eragear-runtime-internal-token";
export const RUNTIME_WRITER_URL_HEADER = "x-eragear-writer-url";

export async function forwardRequestToRuntimeWriter(params: {
  request: Request;
  runtimePolicy: ServerRuntimePolicy;
}): Promise<Response> {
  const writerUrl = params.runtimePolicy.runtimeWriterUrl;
  if (!writerUrl) {
    return new Response(
      JSON.stringify({
        error: "Runtime writer URL is not configured on this reader node",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  }

  const sourceUrl = new URL(params.request.url);
  const targetUrl = new URL(
    `${sourceUrl.pathname}${sourceUrl.search}`,
    writerUrl.endsWith("/") ? writerUrl : `${writerUrl}/`
  );

  const headers = new Headers(params.request.headers);
  if (params.runtimePolicy.runtimeInternalToken) {
    headers.set(
      RUNTIME_INTERNAL_TOKEN_HEADER,
      params.runtimePolicy.runtimeInternalToken
    );
  }
  headers.set("x-eragear-runtime-forwarded", "1");

  const body =
    params.request.method !== "GET" && params.request.method !== "HEAD"
      ? await params.request.arrayBuffer()
      : undefined;

  const response = await fetch(targetUrl, {
    method: params.request.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    redirect: "manual",
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
