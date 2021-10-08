import {Either, left, right} from "fp-chainer/either";
import {fail, Failure} from "fp-chainer/failure";

export interface RequestOptions extends RequestInit {
  variables?: { [p: string]: string | undefined },
  overrider?: (old: { url: string, method: string }) => { url: string, method: string },
}

export const ExceptionUnexpected = "Unexpected" as const;

export type UnexpectedException = Failure<typeof ExceptionUnexpected, number>;

function call<RequestBody, ResponseBody, ExceptionBody extends Failure<string, unknown>>(urlSpec: string, methodSpec: string, options: RequestOptions) {
  const { url, method } = options.overrider ? options.overrider({ url: urlSpec, method: methodSpec }) : { url: urlSpec, method: methodSpec };

  function replaceVariables(template: string, variables: RequestOptions["variables"]): string {
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

  return async (requestBody: RequestBody, runtimeOptions?: RequestOptions): Promise<Either<ExceptionBody | UnexpectedException, ResponseBody>> => {
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
      return left(fail(ExceptionUnexpected, "unexpected internal server error", 0))
    }
  }
}