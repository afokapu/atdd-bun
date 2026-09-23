export function Layout(props: { children: unknown }) {
  return (
    <html lang="en">
      <head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" /></head>
      <body style={{ maxWidth: 1200, width: "100%" }}>{props.children}</body>
    </html>
  );
}
