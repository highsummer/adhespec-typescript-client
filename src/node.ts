import {Either, left, right} from "fp-chainer/lib/either";
import * as https from "https";
import {RequestOptions} from "https";

type RequestType = RequestOptions & { variables?: { [p: string]: string | undefined } };

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
  message: "unexpected internal server error",
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

    return await new Promise((resolve, reject) => {
      const req = https.request(concreteUrl + query, {
        method: method,
        ...options,
        ...runtimeOptions ?? {},
        headers: headers,
      }, res => {
        res.on("data", (data: Buffer) => {
          if (res.statusCode === 200) {
            resolve(right(JSON.parse(data.toString("utf-8"))));
          } else {
            const errorBody = JSON.parse(data.toString("utf-8"));
            resolve(left({
              ...errorBody,
              httpStatusCode: res.statusCode,
            }));
          }
        });
      });

      req.on("error", error => {
        resolve(left({
          code: ExceptionUnexpected,
          body: error,
          httpStatusCode: 500,
          message: "unexpected internal server error",
        }));
      })

      if (method !== "GET") {
        req.write(JSON.stringify(requestBody));
      }
      req.end();
    })
  }
}