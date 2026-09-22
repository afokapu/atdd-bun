// A TypeScript Bun app that actually typechecks: typescript is a devDependency,
// `tsc --noEmit` is wired into the check path, and tsconfig is strict.
export default { fetch: () => new Response("ok") };
