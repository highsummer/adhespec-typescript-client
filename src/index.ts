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
import glob from "glob";
import * as fs from "fs";
import * as ts from "typescript";
import yargs from "yargs";

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
    return [...new Set(model.elements.flatMap(gatherReferences))]
  } else if (model.type === DictionaryModelTypeSignature) {
    return [...new Set(model.fields.flatMap(([_, value]) => gatherReferences(value)))]
  } else if (model.type === MapModelTypeSignature) {
    return [...new Set([...gatherReferences(model.keyType), ...gatherReferences(model.valueType)])]
  } else if (model.type === UnionModelTypeSignature) {
    return [...new Set(model.elements.flatMap(gatherReferences))]
  } else if (model.type === ModelReferenceTypeSignature) {
    return [model.id]
  } else if (model.type === SpecialModelTypeSignature) {
    throw new Error("not supported")
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
    return ts.factory.createMappedTypeNode(
      undefined, ts.factory.createTypeParameterDeclaration("p"),
      toTypeNode(model.keyType), undefined, toTypeNode(model.valueType)
    )
  } else if (model.type === UnionModelTypeSignature) {
    return ts.factory.createUnionTypeNode(model.elements.map(toTypeNode))
  } else if (model.type === ModelReferenceTypeSignature) {
    return ts.factory.createIndexedAccessTypeNode(
      ts.factory.createTypeReferenceNode("ModelReferences"),
      ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(model.id)),
    )
  } else if (model.type === SpecialModelTypeSignature) {
    throw new Error("not supported")
  } else {
    const _: never = model;
    return _
  }
}

function fromContract(contract: HttpRestContract): ts.Expression {
  return ts.factory.createCallExpression(
    ts.factory.createIdentifier("call"),
    [
      toTypeNode(contract.requestBody),
      toTypeNode(contract.responses.find(response => response.code === 200)?.body!),
      contract.responses.filter(response => response.code !== 200).length > 0 ?
        ts.factory.createUnionTypeNode(contract.responses.filter(response => response.code !== 200).map(response => toTypeNode(response.body))) :
        ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
    ],
    [
      ts.factory.createStringLiteral(contract.url),
      ts.factory.createStringLiteral(contract.method),
      ts.factory.createIdentifier("options"),
    ]
  )
}

function fromContracts(contracts: HttpRestContract[]): ts.Expression {
  const references = [...new Set(contracts.flatMap(contract => [
    ...gatherReferences(contract.requestBody),
    ...contract.responses.flatMap(response => gatherReferences(response.body))
  ]))];

  return ts.factory.createArrowFunction(
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
      ts.factory.createTypeReferenceNode("RequestType"),
    )],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.factory.createObjectLiteralExpression(
      contracts.map(contract => {
        console.log(`processing '${contract.id}'`);
        return ts.factory.createPropertyAssignment(ts.factory.createStringLiteral(contract.id), fromContract(contract))
      })
    )
  )
}

async function main() {
  const argv = await yargs(process.argv)
    .string("input")
    .demandOption("input")
    .alias("i", "input")
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

  const apiDeclaration = ts.factory.createVariableStatement(
    undefined, [
      ts.factory.createVariableDeclaration(
        "api", undefined, undefined,
        fromContracts(contractFiles.map(path => JSON.parse(fs.readFileSync(path).toString("utf-8"))))
      )
    ],
  );

  const exportStatement = ts.factory.createExportDefault(ts.factory.createIdentifier("api"));

  const source = ts.factory.createSourceFile(
    [apiDeclaration, exportStatement],
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.Const,
  );

  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
    omitTrailingSemicolon: false,
  });

  const target = argv.type === "browser" ? "./src/browser.ts" :
    argv.type === "node" ? "./src/node.ts" : "";

  fs.writeFileSync(argv.output, `// generated at ${new Date().toISOString()}\n\n` + fs.readFileSync(target) + "\n\n" + printer.printFile(source));
}

main().then();