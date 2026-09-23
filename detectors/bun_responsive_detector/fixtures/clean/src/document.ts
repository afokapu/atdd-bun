import { head } from "./head";

export const page = (body: string) => `<!doctype html>
<html lang="en">
<head>${head}</head>
<body>${body}</body>
</html>`;
