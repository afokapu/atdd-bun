// DIRTY — a TypeScript Bun app with no typescript dependency, no typecheck script, and
// "strict": false. Bun runs this happily; nothing ever checks that the types hold.
export default { fetch: () => new Response("ok") };
