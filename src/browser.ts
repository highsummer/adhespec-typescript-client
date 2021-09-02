import {Either, left, right} from "fp-chainer/lib/either";

const OverrideUrl = (_: string) => _;

type RequestType = RequestInit & { variables?: { [p: string]: string | undefined } };

export type RequestBodyOf<Caller> = Caller extends (requestBody: infer RequestBody, runtimeOptions?: RequestType) => Promise<Either<infer ExceptionBody, infer ResponseBody>> ?
  RequestBody : never;

export type ExceptionsOf<Caller> = Caller extends (requestBody: infer RequestBody, runtimeOptions?: RequestType) => Promise<Either<infer ExceptionBody, infer ResponseBody>> ?
  ExceptionBody : never;

export type SuccessOf<Caller> = Caller extends (requestBody: infer RequestBody, runtimeOptions?: RequestType) => Promise<Either<infer ExceptionBody, infer ResponseBody>> ?
  ResponseBody : never;

export type ResponseBodyOf<Caller> = Either<ExceptionsOf<Caller>, SuccessOf<Caller>>;

export const ExceptionUnexpected = "Unexpected" as const;

export interface UnexpectedException {
  code: typeof ExceptionUnexpected,
  body: any,
  httpStatusCode: number,
  message: "unexpected request error",
}

function call<RequestBody, ResponseBody, ExceptionBody>(url: string, method: string, options: RequestType) {
  function replaceVariables(template: string, variables: RequestType["variables"]): string {
    const replacer = /\$\{([\w\d_]+)\}/;
    const matched = replacer.exec(template);
    if (matched !== null) {
      const key = matched[1];
      const value = variables?.[key];
      if (value === undefined) {
        throw new Error(`'${key}' is not found in variables`)
      } else {
        return replaceVariables(template.replace(replacer, value), variables)
      }
    } else {
      return template
    }
  }

  const concreteUrl = replaceVariables(url, options.variables ?? {});

  return async (requestBody: RequestBody, runtimeOptions?: RequestType): Promise<Either<ExceptionBody | UnexpectedException, ResponseBody>> => {
    const query = method === "GET" ? "?" + Object.entries(requestBody).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&") : "";
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(runtimeOptions?.headers ?? {}),
    };
    try {
      const response = await fetch(
        `${concreteUrl}${query}`,
        {
          method: method,
          mode: "cors",
          ...options,
          ...runtimeOptions ?? {},
          headers: headers,
          body: method !== "GET" ? JSON.stringify(requestBody) : undefined,
        }
      );

      if (response.status === 200) {
        return right(await response.json())
      } else {
        return left(await response.json())
      }
    } catch (e) {
      return left({
        code: ExceptionUnexpected,
        body: e,
        httpStatusCode: 0,
        message: "unexpected request error",
      })
    }
  }
}