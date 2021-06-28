export function getApiTerminal<Req, Resp, Exc>(spec: ApiEndpointSpec<Req, Resp, Exc>, options: RequestInit, config: ApiConfig): ApiDelegate<Req, Resp, Exc> {


  return begin<Req>()
    .be("body")
    .bindPromise(
      "response",
      async ({ body }) => {
        const query = spec.method === "GET" ? "?" + Object.entries(body).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&") : ""
        const headers = {
          "Content-Type": "application/json",
          ...(options.headers || {}),
          // ...(runtimeOptions?.headers || {}),
        };
        const response = await fetch(
          `${config.baseUrl}${spec.path}${query}`,
          {
            method: spec.method,
            mode: "cors",
            credentials: "include",
            ...options,
            // ...(runtimeOptions || {}),
            headers: headers,
            body: spec.method !== "GET" ? JSON.stringify(body) : undefined,
          }
        );
        if (response.status === 200) {
          return right(await response.json())
        } else {
          return left(fail(toExceptionCode(response.status), await response.text()) as unknown as Exc)
        }
      }
    )
    .project("response")
}
