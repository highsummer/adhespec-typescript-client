import {
  ArrayModelTypeSignature,
  BooleanModelTypeSignature,
  DictionaryModelTypeSignature,
  HttpRestContract,
  MapModelTypeSignature,
  Model,
  ModelReferenceTypeSignature,
  NumberModelTypeSignature, SpecialModelTypeSignature,
  StringModelTypeSignature,
  TupleModelTypeSignature,
  UnionModelTypeSignature
} from "adhespec-typescript-interface";
import * as glob from "glob";
import * as fs from "fs";
import * as ts from "typescript";
import yargs from "yargs";
import * as path from "path";
import {SyntaxKind} from "typescript";

function gatherReferences(model: Model): string[] {
  if (model.type === BooleanModelTypeSignature) {
    return []
  } else if (model.type === NumberModelTypeSignature) {
    return []
  } else if (model.type === StringModelTypeSignature) {
    return []
  } else if (model.type === ArrayModelTypeSignature) {
    return gatherReferences(model.elements)
  } else if (model.type === TupleModelTypeSignature) {
    return Array.from(new Set(model.elements.flatMap(gatherReferences)))
  } else if (model.type === DictionaryModelTypeSignature) {
    return Array.from(new Set(model.fields.flatMap(([_, value]) => gatherReferences(value))))
  } else if (model.type === MapModelTypeSignature) {
    return Array.from(new Set([...gatherReferences(model.keyType), ...gatherReferences(model.valueType)]))
  } else if (model.type === UnionModelTypeSignature) {
    return Array.from(new Set(model.elements.flatMap(gatherReferences)))
  } else if (model.type === ModelReferenceTypeSignature) {
    return [model.id]
  } else if (model.type === SpecialModelTypeSignature) {
    if (model.metadata?.special === "any" || model.metadata?.special === "unknown" || model.metadata?.special === "undefined") {
      return []
    } else {
      throw new Error("not supported")
    }
  } else {
    const _: never = model;
    return _
  }
}

function toTypeNode(model: Model): ts.TypeNode {
  if (model.type === BooleanModelTypeSignature) {
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword)
  } else if (model.type === NumberModelTypeSignature) {
    if (model.constraints?.enum !== undefined) {
      return ts.factory.createUnionTypeNode(model.constraints.enum.map(e => ts.factory.createLiteralTypeNode(ts.factory.createNumericLiteral(e))))
    } else {
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
    }
  } else if (model.type === StringModelTypeSignature) {
    /* if (model.format === "datetime-ISO8601") {
      return ts.factory.createTypeReferenceNode("Date")
    } else if (model.format === "date-ISO8601") {
      return ts.factory.createTypeReferenceNode("Date")
    } else */ if (model.constraints?.enum !== undefined) {
      return ts.factory.createUnionTypeNode(model.constraints.enum.map(e => ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(e))))
    } else {
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
    }
  } else if (model.type === ArrayModelTypeSignature) {
    return ts.factory.createArrayTypeNode(toTypeNode(model.elements))
  } else if (model.type === TupleModelTypeSignature) {
    return ts.factory.createTupleTypeNode(model.elements.map(toTypeNode))
  } else if (model.type === DictionaryModelTypeSignature) {
    return ts.factory.createTypeLiteralNode(model.fields.map(([key, value]) => ts.factory.createPropertySignature(undefined, key, value.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined, toTypeNode(value))))
  } else if (model.type === MapModelTypeSignature) {
    return ts.factory.createTypeReferenceNode("Record", [toTypeNode(model.keyType), toTypeNode(model.valueType)])
  } else if (model.type === UnionModelTypeSignature) {
    return ts.factory.createUnionTypeNode(model.elements.map(toTypeNode))
  } else if (model.type === ModelReferenceTypeSignature) {
    return ts.factory.createIndexedAccessTypeNode(
      ts.factory.createTypeReferenceNode("ModelReferences"),
      ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(model.id)),
    )
  } else if (model.type === SpecialModelTypeSignature) {
    if (model.metadata?.special === "any") {
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
    } else if (model.metadata?.special === "unknown") {
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
    } else if (model.metadata?.special === "undefined") {
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)
    } else {
      throw new Error("not supported")
    }
  } else {
    const _: never = model;
    return _
  }
}

function fromContractToTypes(contract: HttpRestContract): { request: ts.TypeNode, success: ts.TypeNode, exceptions: ts.TypeNode } {
  return {
    request: toTypeNode(contract.requestBody),
    success: toTypeNode(contract.responses.find(response => response.code === 200)?.body!),
    exceptions: contract.responses.filter(response => response.code !== 200).length > 0 ?
      ts.factory.createUnionTypeNode(contract.responses.filter(response => response.code !== 200).map(response => toTypeNode(response.body))) :
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
  }
}

function fromContract(types: { request: ts.TypeNode, success: ts.TypeNode, exceptions: ts.TypeNode }, contract: HttpRestContract): ts.Expression {
  return ts.factory.createCallExpression(
    ts.factory.createIdentifier("call"),
    [types.request, types.success, types.exceptions],
    [
      ts.factory.createStringLiteral(contract.url),
      ts.factory.createStringLiteral(contract.method),
      ts.factory.createIdentifier("options"),
    ]
  )
}

function fromContracts(alias: string, contracts: HttpRestContract[]): ts.Statement[] {
  const references = Array.from(new Set(contracts.flatMap(contract => [
    ...gatherReferences(contract.requestBody),
    ...contract.responses.flatMap(response => gatherReferences(response.body))
  ])));

  const types = ts.factory.createTypeLiteralNode(
    contracts.map(contract => {
      const { request, success, exceptions } = fromContractToTypes(contract);
      return ts.factory.createPropertySignature(
        undefined, ts.factory.createStringLiteral(contract.id), undefined,
        ts.factory.createTypeLiteralNode([
          ts.factory.createPropertySignature(undefined, "request", undefined, request),
          ts.factory.createPropertySignature(undefined, "success", undefined, success),
          ts.factory.createPropertySignature(undefined, "exceptions", undefined, exceptions),
        ])
      )
    })
  );

  return [
    ts.factory.createTypeAliasDeclaration(
      undefined,
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      `${alias}Types`,
      [
        ts.factory.createTypeParameterDeclaration(
          "ModelReferences", ts.factory.createTypeLiteralNode(
            references.map(reference => ts.factory.createPropertySignature(
              undefined, ts.factory.createStringLiteral(reference), undefined,
              ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
            ))
          ),
        ),
      ],
      types
    ),
    ts.factory.createVariableStatement(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)], ts.factory.createVariableDeclarationList(
        [ts.factory.createVariableDeclaration(
          `${alias}Api`, undefined, undefined,
          ts.factory.createArrowFunction(
            undefined,
            [
              ts.factory.createTypeParameterDeclaration(
                "ModelReferences", ts.factory.createTypeLiteralNode(
                  references.map(reference => ts.factory.createPropertySignature(
                    undefined, ts.factory.createStringLiteral(reference), undefined,
                    ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                  ))
                ),
              ),
            ],
            [ts.factory.createParameterDeclaration(
              undefined, undefined, undefined, "options", undefined,
              ts.factory.createTypeReferenceNode("RequestOptions"),
            )],
            undefined,
            ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            ts.factory.createObjectLiteralExpression(
              contracts.map(contract => {
                const baseType = ts.factory.createIndexedAccessTypeNode(
                  ts.factory.createTypeReferenceNode(`${alias}Types`, [ts.factory.createTypeReferenceNode("ModelReferences")]),
                  ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(contract.id))
                );
                return ts.factory.createPropertyAssignment(
                  ts.factory.createStringLiteral(contract.id),
                  fromContract({
                    request: ts.factory.createIndexedAccessTypeNode(
                      baseType,
                      ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral("request")),
                    ),
                    success: ts.factory.createIndexedAccessTypeNode(
                      baseType,
                      ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral("success")),
                    ),
                    exceptions: ts.factory.createIndexedAccessTypeNode(
                      baseType,
                      ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral("exceptions")),
                    )
                  }, contract),
                )
              })
            )
          ),
        )]
      )
    )
  ]
}

async function main() {
  const argv = await yargs(process.argv)
    .string("input")
    .demandOption("input")
    .alias("i", "input")
    .string("alias")
    .demandOption("alias")
    .alias("a", "alias")
    .string("output")
    .default({ output: "api.ts" })
    .alias("o", "output")
    .string("type")
    .demandOption("type")
    .alias("t", "type")
    .argv;

  const contractFiles = await new Promise<string[]>((resolve, reject) => glob(argv.input, (err, filePaths) => {
    if (err) {
      reject(err);
    } else {
      resolve(filePaths);
    }
  }));

  const apiDeclarations = fromContracts(argv.alias, contractFiles.map(path => JSON.parse(fs.readFileSync(path).toString("utf-8"))));

  const exportStatement = ts.factory.createExportDefault(ts.factory.createIdentifier(`${argv.alias}Api`));

  const source = ts.factory.createSourceFile(
    [...apiDeclarations, exportStatement],
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.Const,
  );

  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
    omitTrailingSemicolon: false,
  });

  const target = argv.type === "browser" ? path.join(__dirname, "..", "src/browser.ts") :
    argv.type === "node" ? path.join(__dirname, "..", "src/node.ts") : "";

  fs.writeFileSync(argv.output, `// generated at ${new Date().toISOString()}\n\n` + fs.readFileSync(target) + "\n\n" + printer.printFile(source));
}

main().then();