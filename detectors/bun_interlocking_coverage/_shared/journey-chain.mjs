// Journey-mediated Station Master proof on the TypeScript AST.
//
// The chain is pinned method to method: the exported action's first reachable return is a
// `JourneyRunner` execution; `JourneyRunner.execute`'s first reachable return is an
// `InterlockingRunner` execution; and `InterlockingRunner.execute` resolves on `this` and its first
// reachable return is the `TrainRunner` execution of that same, unmodified resolution. Lexical
// scanning kept missing whole classes of dead or discarded code (dead branches, comments, comma,
// ternary, logical and `void` operands, aliases); the AST decides each of these structurally.
import ts from "typescript";

const parse = (text, file = "module.ts") =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

// Wrappers that keep the operand's value: grouping, await, and type-only assertions.
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) {
    node = node.expression;
  }
  return node;
}

const isIdentifier = (node, name) => Boolean(node && ts.isIdentifier(node) && (name === undefined || node.text === name));

function classMethod(source, className, methodName) {
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== className) continue;
    for (const member of statement.members) {
      if (ts.isMethodDeclaration(member) && member.body && ts.isIdentifier(member.name) && member.name.text === methodName) return member;
    }
  }
  return null;
}

const exported = (node) => ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export;

function exportedFunction(source, name) {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body && exported(statement)) return statement;
    if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (isIdentifier(declaration.name, name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body && ts.isBlock(init.body)) return init;
      }
    }
  }
  return null;
}

// The first `return` that runs whenever control reaches it, plus the `const` declarations passed on
// the way. Plain blocks and `try` blocks always run; conditional, loop, switch, and `catch` bodies may
// not, so they are skipped. A `throw` (or a `finally` holding a `return`) ends the search with nothing.
function firstReachableReturn(block) {
  const constants = new Map();
  function scan(statements) {
    for (const statement of statements) {
      if (ts.isReturnStatement(statement)) return statement;
      if (ts.isThrowStatement(statement)) return false;
      if (ts.isBlock(statement)) {
        const found = scan(statement.statements);
        if (found !== undefined) return found;
      } else if (ts.isTryStatement(statement)) {
        if (statement.finallyBlock && containsReturn(statement.finallyBlock)) return false;
        const found = scan(statement.tryBlock.statements);
        if (found !== undefined) return found;
      } else if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    return undefined;
  }
  const found = scan(block.statements);
  return { statement: found || null, constants };
}

function containsReturn(node) {
  let found = false;
  (function visit(child) {
    if (found || ts.isFunctionLike(child)) return;
    if (ts.isReturnStatement(child)) { found = true; return; }
    ts.forEachChild(child, visit);
  })(node);
  return found;
}

// True when the returned expression IS a matching expression or carries it unchanged: directly, as a
// property or spread of a returned object, an element of a returned array, the argument of
// `Object.freeze`, or a `const` the method assigned from it. Conditional, logical, comma, arithmetic,
// unary (`void`, `!`, ...) and function wrappers replace or may skip the value, so they never carry it.
function carries(expression, matches, constants, seen = new Set()) {
  const node = unwrap(expression);
  if (!node) return false;
  if (matches(node)) return true;
  if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
    seen.add(node.text);
    return carries(constants.get(node.text), matches, constants, seen);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) =>
      (ts.isPropertyAssignment(property) && carries(property.initializer, matches, constants, seen)) ||
      (ts.isShorthandPropertyAssignment(property) && carries(property.name, matches, constants, seen)) ||
      (ts.isSpreadAssignment(property) && carries(property.expression, matches, constants, seen)));
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => carries(ts.isSpreadElement(element) ? element.expression : element, matches, constants, seen));
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    isIdentifier(node.expression.expression, "Object") && node.expression.name.text === "freeze") {
    return node.arguments.some((argument) => carries(argument, matches, constants, seen));
  }
  return false;
}

function returnsCarrying(body, matches) {
  const { statement, constants } = firstReachableReturn(body);
  return Boolean(statement?.expression && carries(statement.expression, matches, constants));
}

// `<receiver>.execute(...)` where the receiver is `new <Class>(...)`, or a `const` initialized to one.
function executesNew(className, constants) {
  const constructs = (node) => {
    node = unwrap(node);
    if (ts.isNewExpression(node) && isIdentifier(node.expression, className)) return true;
    return ts.isIdentifier(node) && constants.has(node.text) && ts.isNewExpression(unwrap(constants.get(node.text))) &&
      isIdentifier(unwrap(constants.get(node.text)).expression, className);
  };
  return (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "execute" && constructs(node.expression.expression);
}

function returnsExecutionOf(body, className) {
  const { statement, constants } = firstReachableReturn(body);
  return Boolean(statement?.expression && carries(statement.expression, executesNew(className, constants), constants));
}

const member = (node, object, names) =>
  ts.isPropertyAccessExpression(node) && isIdentifier(node.expression, object) && names.includes(node.name.text);

const mentions = (node, name) => {
  let found = false;
  (function visit(child) {
    if (found) return;
    if (isIdentifier(child, name) && !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)) found = true;
    else ts.forEachChild(child, visit);
  })(node);
  return found;
};

// The TrainRunner execution of `resolution`: legacy `new TrainRunner(r.trainId|r.selectedTrainId).execute(...)`
// or declaration `new TrainRunner(r.trainPath, ...args without r).execute(r, ...)`.
function trainExecutionOf(resolution) {
  return (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "execute") return false;
    const runner = unwrap(node.expression.expression);
    if (!ts.isNewExpression(runner) || !isIdentifier(runner.expression, "TrainRunner")) return false;
    const [first, ...rest] = runner.arguments ?? [];
    if (!first) return false;
    if (rest.length === 0 && member(first, resolution, ["trainId", "selectedTrainId"])) return true;
    return member(first, resolution, ["trainPath"]) && !rest.some((argument) => mentions(argument, resolution)) &&
      isIdentifier(unwrap(node.arguments[0] ?? null), resolution);
  };
}

// Every reference to the resolution in the method must leave it unchanged and unaliased: member reads
// (not assigned, updated, deleted, or called), `void`/`console.*` operands, the TrainRunner execution's
// own arguments, and object/array values inside the returned expression. A second binding of the same
// name anywhere in the method is refused outright.
function resolutionUnchanged(method, declaration, resolution, returned) {
  let safe = true;
  const inside = (node, container) => Boolean(container) && node.pos >= container.pos && node.end <= container.end;
  (function visit(node) {
    if (!safe) return;
    if (node !== declaration && (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      isIdentifier(node.name, resolution)) { safe = false; return; }
    if (isIdentifier(node, resolution) && node !== declaration.name) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) return; // `x.resolution`
      if ((ts.isPropertyAssignment(parent) && parent.name === node)) return; // `{ resolution: ... }` key
      if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) {
        let top = parent;
        while ((ts.isPropertyAccessExpression(top.parent) || ts.isElementAccessExpression(top.parent)) && top.parent.expression === top) top = top.parent;
        const holder = top.parent;
        const written = (ts.isBinaryExpression(holder) && holder.left === top && holder.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          holder.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
          ((ts.isPrefixUnaryExpression(holder) || ts.isPostfixUnaryExpression(holder)) &&
            (holder.operator === ts.SyntaxKind.PlusPlusToken || holder.operator === ts.SyntaxKind.MinusMinusToken)) ||
          ts.isDeleteExpression(holder) || (ts.isCallExpression(holder) && holder.expression === top);
        if (written) safe = false;
        return;
      }
      if (ts.isVoidExpression(parent)) return;
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) &&
        isIdentifier(parent.expression.expression, "console") && parent.arguments.includes(node)) return;
      if (ts.isCallExpression(parent) && parent.arguments[0] === node && trainExecutionOf(resolution)(parent)) return;
      if ((ts.isShorthandPropertyAssignment(parent) || (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
        ts.isArrayLiteralExpression(parent)) && inside(node, returned)) return;
      safe = false;
      return;
    }
    ts.forEachChild(node, visit);
  })(method.body);
  return safe;
}

// InterlockingRunner.execute: `const r = this.resolveTrain(...)` in the reachable statement path, then
// the first reachable return carries `r`'s TrainRunner execution with `r` unchanged throughout.
export function interlockingExecuteReturnsTrainExecution(text, file) {
  const method = classMethod(parse(text, file), "InterlockingRunner", "execute");
  if (!method) return false;
  const { statement } = firstReachableReturn(method.body);
  if (!statement?.expression) return false;
  const declarations = [];
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const call = unwrap(node.initializer);
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
        call.expression.expression.kind === ts.SyntaxKind.ThisKeyword && call.expression.name.text === "resolveTrain") declarations.push(node);
    }
    if (!ts.isFunctionLike(node) || node === method) ts.forEachChild(node, visit);
  })(method);
  return declarations.some((declaration) => {
    const resolution = declaration.name.text;
    return returnsCarrying(method.body, trainExecutionOf(resolution)) &&
      resolutionUnchanged(method, declaration, resolution, statement.expression);
  });
}

// JourneyRunner.execute's first reachable return carries an InterlockingRunner execution.
export function journeyExecuteReturnsInterlockingExecution(text, file) {
  const method = classMethod(parse(text, file), "JourneyRunner", "execute");
  return Boolean(method && returnsExecutionOf(method.body, "InterlockingRunner"));
}

// The exported Station Master action's first reachable return carries a JourneyRunner execution.
export function actionReturnsJourneyExecution(text, file, action) {
  const fn = exportedFunction(parse(text, file), action);
  return Boolean(fn && returnsExecutionOf(fn.body, "JourneyRunner"));
}
