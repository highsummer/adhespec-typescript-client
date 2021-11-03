import {Either, left, right} from "fp-chainer/either";
import * as https from "https";
import {RequestOptions as HttpsRequestOptions} from "https";
import {fail, Failure} from "fp-chainer/failure";

export interface RequestOptions extends HttpsRequestOptions {
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

    return await new Promise((resolve, reject) => {
      const req = https.request(concreteUrl + query, {
        method: method,
        ...options,
        ...runtimeOptions ?? {},
        headers: headers,
      }, res => {
        let payload: string = "";

        res.on("data", (data: Buffer) => {
          payload += data.toString("utf-8");
        });

        res.on("end", () => {
          try {
            if (res.statusCode === 200) {
              resolve(right(JSON.parse(payload)));
            } else {
              const errorBody = JSON.parse(payload);
              resolve(left(fail(errorBody.code, errorBody.message, res.statusCode)));
            }
          } catch (e) {
            resolve(left(fail(ExceptionUnexpected, e.message, 500)));
          }
        });
      });

      req.on("error", error => {
        resolve(left(fail(ExceptionUnexpected, "unexpected internal server error", 500)));
      })

      if (method !== "GET") {
        req.write(JSON.stringify(requestBody));
      }
      req.end();
    })
  }
}