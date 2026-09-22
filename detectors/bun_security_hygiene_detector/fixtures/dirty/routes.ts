Bun.serve({
  routes: {
    "/orders": {
      POST: async (req) => {
        const body = await req.json();
        return Response.json({ ok: true });
      },
    },
  },
});
