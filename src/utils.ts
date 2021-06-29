import {HttpRestContract} from "adhespec-typescript-interface";
import {Either, left, right} from "fp-chainer/lib/either";

function call<RequestBody, ResponseBody, ExceptionBody>(contract: HttpRestContract, options: RequestInit) {
  return async (requestBody: RequestBody, runtimeOptions?: RequestInit): Promise<Either<ExceptionBody, ResponseBody>> => {
    const query = contract.method === "GET" ? "?" + Object.entries(requestBody).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&") : "";
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(runtimeOptions?.headers ?? {}),
    };
    const response = await fetch(
      `${contract.url}${query}`,
      {
        method: contract.method,
        mode: "cors",
        credentials: "include",
        ...options,
        ...runtimeOptions ?? {},
        headers: headers,
        body: contract.method !== "GET" ? JSON.stringify(requestBody) : undefined,
      }
    );

    if (response.status === 200) {
      return right(await response.json())
    } else {
      return left(await response.json())
    }
  }
}