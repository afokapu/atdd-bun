// Journey-mediated Station Master chain, proven on the TypeScript AST with binding resolution.
//
// One proof for both interlocking detector families (tester coverage and coder routing). Hop by hop:
//   exported Station Master action -> JourneyRunner.execute -> InterlockingRunner.execute -> TrainRunner
// Each hop's runner identifier must BIND (type-checker symbol, not spelling) to a named import from a
// local, non-test production module, and that module must export the runner class with a single own
// `execute` method that no field, accessor, duplicate, constructor or prototype assignment overrides.
// Every live return of the hop's method (outside `catch`, which only runs once the hop has thrown) must
// carry the next hop's execution, and at least one must exist. Lexical scanning missed whole classes of
// dead, discarded, shadowed or overridden code; these are decided structurally here.
import ts from "typescript";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const programs = new Map();

// A single-file program: enough for the checker to bind every identifier in the module to its
// declaration (imports stay unresolved aliases, so nothing outside the file is read).
function analyze(file, text = readFileSync(file, "utf8")) {
  const key = `${file}\0${text}`;
  if (programs.has(key)) return programs.get(key);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = {
    getSourceFile: (name) => (name === file ? source : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => dirname(file),
    getDirectories: () => [],
    fileExists: (name) => name === file,
    readFile: (name) => (name === file ? text : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram([file], { noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.Latest }, host);
  const result = { file, source, checker: program.getTypeChecker() };
  programs.set(key, result);
  return result;
}

// Wrappers that keep the operand's value: grouping, await, and type-only assertions.
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) {
    node = node.expression;
  }
  return node;
}

function declarationOf(ctx, identifier) {
  const symbol = ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
    ? ctx.checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : ctx.checker.getSymbolAtLocation(identifier);
  return symbol?.declarations?.[0] ?? null;
}

const symbolOf = (ctx, identifier) =>
  (ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
    ? ctx.checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : ctx.checker.getSymbolAtLocation(identifier)) ?? null;

// A free identifier (no declaration in the module), i.e. the ambient global such as Object/console.
const isGlobal = (ctx, node, name) => ts.isIdentifier(node) && node.text === name && !declarationOf(ctx, node);

function productionModule(specifier, file, croot) {
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(file), specifier);
  const root = resolve(croot) + sep;
  const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.mjs`, join(target, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile() && candidate.startsWith(root) &&
    !/\.(test|spec)\.[cm]?[jt]sx?$/.test(candidate)) ?? null;
}

// The production module `identifier` binds to when it is a value import of `name`, else null.
function importedRunner(ctx, identifier, name, croot) {
  if (!identifier || !ts.isIdentifier(identifier)) return null;
  const declaration = declarationOf(ctx, identifier);
  if (!declaration || !ts.isImportSpecifier(declaration) || declaration.isTypeOnly) return null;
  if ((declaration.propertyName ?? declaration.name).text !== name) return null;
  const clause = declaration.parent.parent;
  const statement = clause.parent;
  if (clause.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) return null;
  return productionModule(statement.moduleSpecifier.text, ctx.file, croot);
}

function constInitializer(ctx, identifier) {
  const declaration = declarationOf(ctx, identifier);
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
    ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const
    ? declaration.initializer
    : null;
}

const memberName = (member) => {
  const name = member.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
};
const isStatic = (member) => Boolean(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static);

function exportedClass(ctx, name) {
  let found = null, exported = false;
  for (const statement of ctx.source.statements) {
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
      if (found) return null;
      found = statement;
      exported ||= Boolean(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export);
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      exported ||= statement.exportClause.elements.some((element) => (element.propertyName ?? element.name).text === name);
    }
  }
  return found && exported ? found : null;
}

function walk(node, visit, intoFunctions = true) {
  (function step(child) {
    if (visit(child) === false) return;
    if (!intoFunctions && child !== node && ts.isFunctionLike(child)) return;
    ts.forEachChild(child, step);
  })(node);
}

// The class's own instance method `name`, provided nothing else can replace it on an instance.
function soleMethod(ctx, cls, name) {
  const members = cls.members.filter((member) => !ts.isConstructorDeclaration(member) && memberName(member) === name);
  const method = members[0];
  if (members.length !== 1 || !ts.isMethodDeclaration(method) || !method.body || isStatic(method)) return null;
  let overridden = false;
  const assigns = (target) => {
    const node = unwrap(target);
    return (ts.isPropertyAccessExpression(node) && node.name.text === name) ||
      (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === name);
  };
  walk(ctx.source, (node) => {
    if (overridden) return false;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && assigns(node.left)) {
      const owner = unwrap(node.left).expression;
      if (owner.kind === ts.SyntaxKind.ThisKeyword || /\bprototype\b/.test(owner.getText())) overridden = true;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isGlobal(ctx, node.expression.expression, "Object") &&
      ["defineProperty", "defineProperties", "assign", "setPrototypeOf"].includes(node.expression.name.text) &&
      node.arguments[0] && /\bprototype\b|^this$/.test(node.arguments[0].getText())) overridden = true;
  });
  return overridden ? null : method;
}

// Statically known truthiness of a condition, or undefined.
function constant(node) {
  node = unwrap(node);
  if (!node) return undefined;
  switch (node.kind) {
    case ts.SyntaxKind.TrueKeyword: return true;
    case ts.SyntaxKind.FalseKeyword: case ts.SyntaxKind.NullKeyword: return false;
  }
  if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
  if (ts.isStringLiteralLike(node)) return node.text.length > 0;
  if (ts.isIdentifier(node) && node.text === "undefined") return false;
  if (ts.isVoidExpression(node)) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = constant(node.operand);
    return inner === undefined ? undefined : !inner;
  }
  return undefined;
}

// True when control can never continue past `statement`.
function terminates(statement) {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement) || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) return true;
  if (ts.isBlock(statement)) return statement.statements.some(terminates);
  if (ts.isIfStatement(statement)) {
    const value = constant(statement.expression);
    if (value === true) return terminates(statement.thenStatement);
    if (value === false) return Boolean(statement.elseStatement && terminates(statement.elseStatement));
    return Boolean(statement.elseStatement && terminates(statement.thenStatement) && terminates(statement.elseStatement));
  }
  return false;
}

// True when `node` can never run: a constant-false branch or loop, or code after a terminating statement.
function dead(node, boundary) {
  for (let child = node, parent = node.parent; child !== boundary && parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent)) {
      const value = constant(parent.expression);
      if (child === parent.thenStatement && value === false) return true;
      if (child === parent.elseStatement && value === true) return true;
    }
    if ((ts.isWhileStatement(parent) || ts.isForStatement(parent)) && child === parent.statement && parent.condition !== undefined &&
      constant(ts.isWhileStatement(parent) ? parent.expression : parent.condition) === false) return true;
    const statements = ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent) ? parent.statements : null;
    if (statements) {
      const index = statements.indexOf(child);
      if (statements.slice(0, index).some(terminates)) return true;
    }
  }
  return false;
}

const insideCatch = (node, boundary) => {
  for (let parent = node.parent; parent && parent !== boundary; parent = parent.parent) if (ts.isCatchClause(parent)) return true;
  return false;
};

// Expressions of the function's live, non-catch returns; null when a `finally` can override them.
function liveReturns(fn) {
  if (!fn.body) return null;
  if (!ts.isBlock(fn.body)) return [fn.body];
  const returns = [];
  let overridable = false;
  walk(fn.body, (node) => {
    if (ts.isTryStatement(node) && node.finallyBlock) {
      walk(node.finallyBlock, (inner) => { if (ts.isReturnStatement(inner)) overridable = true; }, false);
    }
    if (ts.isReturnStatement(node) && !insideCatch(node, fn.body) && !dead(node, fn.body)) returns.push(node.expression ?? null);
  }, false);
  return overridable ? null : returns;
}

// The value of `expression` IS a matching expression or carries it unchanged: directly, through both
// arms of a conditional, as a member/spread of it, an object property or array element, an
// `Object.freeze` argument, or a `const` bound to it. Logical, comma, arithmetic, unary (`void`, `!`)
// and calls to anything else replace or may skip the value, so they never carry it.
function carries(ctx, expression, matches, seen = new Set()) {
  const node = unwrap(expression);
  if (!node) return false;
  if (matches(node)) return true;
  if (ts.isIdentifier(node)) {
    const initializer = constInitializer(ctx, node);
    // `seen` guards cycles along this path only; sibling branches may resolve the same const.
    if (!initializer || seen.has(initializer)) return false;
    seen.add(initializer);
    const carried = carries(ctx, initializer, matches, seen);
    seen.delete(initializer);
    return carried;
  }
  if (ts.isConditionalExpression(node)) return carries(ctx, node.whenTrue, matches, seen) && carries(ctx, node.whenFalse, matches, seen);
  if (ts.isPropertyAccessExpression(node)) return carries(ctx, node.expression, matches, seen);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) =>
      (ts.isPropertyAssignment(property) && carries(ctx, property.initializer, matches, seen)) ||
      (ts.isShorthandPropertyAssignment(property) && carries(ctx, property.name, matches, seen)) ||
      (ts.isSpreadAssignment(property) && carries(ctx, property.expression, matches, seen)));
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => carries(ctx, ts.isSpreadElement(element) ? element.expression : element, matches, seen));
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    isGlobal(ctx, node.expression.expression, "Object") && node.expression.name.text === "freeze") {
    return node.arguments.some((argument) => carries(ctx, argument, matches, seen));
  }
  return false;
}

function allReturnsCarry(ctx, fn, matches) {
  const returns = liveReturns(fn);
  return Boolean(returns?.length) && returns.every((expression) => expression && carries(ctx, expression, matches));
}

// `<receiver>.execute(...)` where the receiver is `new <Runner>(...)` (or a const bound to one) and
// <Runner> binds to a production import; each such module is added to `modules`.
function executesImported(ctx, runner, croot, modules, accept = () => true) {
  const construction = (node) => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) node = unwrap(constInitializer(ctx, node));
    if (!node || !ts.isNewExpression(node) || !accept(node)) return null;
    return importedRunner(ctx, node.expression, runner, croot);
  };
  return (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "execute") return false;
    const module = construction(node.expression.expression);
    if (module) modules.add(module);
    return Boolean(module);
  };
}

// Each module must export `runner` whose sole execute satisfies `proof(ctx, method)`.
function everyModule(modules, runner, proof) {
  return modules.size > 0 && [...modules].every((file) => {
    const ctx = analyze(file);
    const cls = exportedClass(ctx, runner);
    const method = cls && soleMethod(ctx, cls, "execute");
    return Boolean(method && proof(ctx, cls, method));
  });
}

// The TrainRunner execution of the resolution bound to `symbol`: legacy
// `new TrainRunner(r.trainId|r.selectedTrainId).execute(...)`, or declaration
// `new TrainRunner(r.trainPath, ...args without r).execute(r, ...)`.
function trainExecutionOf(ctx, symbol, croot) {
  const isResolution = (node) => Boolean(node) && ts.isIdentifier(unwrap(node)) && symbolOf(ctx, unwrap(node)) === symbol;
  const member = (node, names) => ts.isPropertyAccessExpression(node) && isResolution(node.expression) && names.includes(node.name.text);
  const mentions = (node) => {
    let found = false;
    walk(node, (child) => { if (found) return false; if (ts.isIdentifier(child) && symbolOf(ctx, child) === symbol) found = true; });
    return found;
  };
  return (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "execute") return false;
    const runner = unwrap(node.expression.expression);
    if (!ts.isNewExpression(runner) || !importedRunner(ctx, runner.expression, "TrainRunner", croot)) return false;
    const [first, ...rest] = runner.arguments ?? [];
    if (!first) return false;
    if (rest.length === 0 && member(first, ["trainId", "selectedTrainId"])) return true;
    return member(first, ["trainPath"]) && !rest.some(mentions) && isResolution(node.arguments[0]);
  };
}

// Every reference to the resolution must leave it unchanged and unaliased: member reads (never
// assigned, updated, deleted or called), `void` and global `console.*` operands, the TrainRunner
// execution's own resolution argument, and object/array values inside a live returned expression.
function resolutionUnchanged(ctx, method, declaration, symbol, returns, isExecution) {
  let safe = true;
  const inReturn = (node) => returns.some((expression) => expression && node.pos >= expression.pos && node.end <= expression.end);
  walk(method, (node) => {
    if (!safe) return false;
    if (!ts.isIdentifier(node) || node === declaration.name || symbolOf(ctx, node) !== symbol) return;
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) {
      if (parent.expression !== node) return;
      let top = parent;
      while ((ts.isPropertyAccessExpression(top.parent) || ts.isElementAccessExpression(top.parent)) && top.parent.expression === top) top = top.parent;
      const holder = top.parent;
      if ((ts.isBinaryExpression(holder) && holder.left === top && holder.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        holder.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
        ((ts.isPrefixUnaryExpression(holder) || ts.isPostfixUnaryExpression(holder)) &&
          (holder.operator === ts.SyntaxKind.PlusPlusToken || holder.operator === ts.SyntaxKind.MinusMinusToken)) ||
        ts.isDeleteExpression(holder) || (ts.isCallExpression(holder) && holder.expression === top)) safe = false;
      return;
    }
    if (ts.isVoidExpression(parent)) return;
    if (ts.isCallExpression(parent) && parent.arguments.includes(node) && ts.isPropertyAccessExpression(parent.expression) &&
      isGlobal(ctx, parent.expression.expression, "console")) return;
    if (ts.isCallExpression(parent) && parent.arguments[0] === node && isExecution(parent)) return;
    if ((ts.isShorthandPropertyAssignment(parent) || (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
      ts.isArrayLiteralExpression(parent)) && inReturn(node)) return;
    safe = false;
  });
  return safe;
}

// InterlockingRunner.execute: `const r = this.resolveTrain(...)` (resolveTrain also a sole method), and
// every live return carries r's TrainRunner execution with r unchanged throughout.
function interlockingExecutes(croot) {
  return (ctx, cls, method) => {
    if (!soleMethod(ctx, cls, "resolveTrain")) return false;
    const returns = liveReturns(method);
    if (!returns?.length) return false;
    const declarations = [];
    walk(method.body, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
      const call = unwrap(node.initializer);
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
        call.expression.expression.kind === ts.SyntaxKind.ThisKeyword && call.expression.name.text === "resolveTrain") declarations.push(node);
    }, false);
    return declarations.some((declaration) => {
      const symbol = symbolOf(ctx, declaration.name);
      const isExecution = trainExecutionOf(ctx, symbol, croot);
      return Boolean(symbol) && allReturnsCarry(ctx, method, isExecution) &&
        resolutionUnchanged(ctx, method, declaration, symbol, returns, isExecution);
    });
  };
}

function journeyExecutes(croot) {
  return (ctx, _cls, method) => {
    const modules = new Set();
    return allReturnsCarry(ctx, method, executesImported(ctx, "InterlockingRunner", croot, modules)) &&
      everyModule(modules, "InterlockingRunner", interlockingExecutes(croot));
  };
}

// Exported functions of the module by name: declarations and const-bound arrow/function expressions.
function exportedFunctions(ctx) {
  const out = new Map();
  for (const statement of ctx.source.statements) {
    const exported = Boolean(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) out.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer && unwrap(declaration.initializer);
        if (ts.isIdentifier(declaration.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) out.set(declaration.name.text, init);
      }
    }
  }
  return out;
}

// The exported Station Master action `name` returns, on every live path, a JourneyRunner execution
// (constructed from a mapped `.path`) whose chain reaches TrainRunner as described above.
export function provenJourneyAction(stationText, stationFile, croot, name) {
  if (!stationText || !stationFile || !croot) return false;
  const ctx = analyze(stationFile, stationText);
  const fn = exportedFunctions(ctx).get(name);
  if (!fn) return false;
  const modules = new Set();
  const fromMappedPath = (construction) => {
    const first = construction.arguments?.[0] && unwrap(construction.arguments[0]);
    return Boolean(first && ts.isPropertyAccessExpression(first) && first.name.text === "path");
  };
  return allReturnsCarry(ctx, fn, executesImported(ctx, "JourneyRunner", croot, modules, fromMappedPath)) &&
    everyModule(modules, "JourneyRunner", journeyExecutes(croot));
}

// Names of every exported Station Master action proven by provenJourneyAction.
export function provenJourneyActions(stationText, stationFile, croot) {
  if (!stationText || !stationFile || !croot) return [];
  const ctx = analyze(stationFile, stationText);
  return [...exportedFunctions(ctx).keys()].filter((name) => provenJourneyAction(stationText, stationFile, croot, name));
}

// An exported Station Master entry (e.g. an HTTP-shaped stationMaster) that awaits one exported action
// with a literal action name into a live `const`, and whose every live return's value (for a returned
// call or construction, its first argument) depends on that const, directly or through consts derived
// from it. Returns { action, callee } or null.
export function entryDelegatedAction(stationText, stationFile, entry) {
  if (!stationText || !stationFile) return null;
  const ctx = analyze(stationFile, stationText);
  const functions = exportedFunctions(ctx);
  const fn = functions.get(entry);
  if (!fn || !ts.isBlock(fn.body)) return null;
  let delegation = null;
  walk(fn.body, (node) => {
    if (delegation || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    if (!(ts.isVariableDeclarationList(node.parent) && node.parent.flags & ts.NodeFlags.Const)) return;
    const call = unwrap(node.initializer);
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !ts.isStringLiteralLike(call.arguments[0] ?? {})) return;
    const callee = declarationOf(ctx, call.expression);
    const name = call.expression.text;
    if (!callee || functions.get(name) !== (ts.isVariableDeclaration(callee) ? unwrap(callee.initializer) : callee) || name === entry) return;
    if (dead(node, fn.body) || insideCatch(node, fn.body)) return;
    delegation = { action: call.arguments[0].text, callee: name, symbol: symbolOf(ctx, node.name) };
  }, false);
  if (!delegation) return null;
  const derived = new Set([delegation.symbol]);
  const dependsOn = (expression) => {
    let found = false;
    walk(expression, (child) => {
      if (found) return false;
      if (!ts.isIdentifier(child)) return;
      const symbol = symbolOf(ctx, child);
      if (derived.has(symbol)) { found = true; return false; }
      const initializer = constInitializer(ctx, child);
      if (initializer && initializer !== expression && dependsOn(initializer)) { derived.add(symbol); found = true; return false; }
    });
    return found;
  };
  // A returned call or construction (e.g. `Response.json(body, init)`) must take its body, the first
  // argument, from the execution; status or headers derived from it alone are not the result.
  const valueDepends = (expression) => {
    const node = unwrap(expression);
    if (ts.isConditionalExpression(node)) return valueDepends(node.whenTrue) && valueDepends(node.whenFalse);
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments?.length) return dependsOn(node.arguments[0]);
    return dependsOn(node);
  };
  const returns = liveReturns(fn);
  return returns?.length && returns.every((expression) => expression && valueDepends(expression))
    ? { action: delegation.action, callee: delegation.callee }
    : null;
}
