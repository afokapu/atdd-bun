// Purpose: the compliant reference for this family.
import { logger } from "./logger";
import { requireUser } from "./auth";

const apiKey = process.env.API_KEY;          // from the environment, never source

Bun.serve({
  routes: {
    "/orders": {
      POST: async (req) => {
        const user = await requireUser(req);  // authorisation before any write
        // Parameterised query: Bun.sql's tagged template binds the value.
        const rows = await sql`SELECT * FROM orders WHERE owner = ${user.id}`;
        logger.info("orders listed", { userId: user.id, count: rows.length });
        return Response.json({ rows });
      },
    },
  },
});

export function failure() {
  // Structured error payload with an UPPER_SNAKE_CASE machine key.
  return Response.json({ "error_code": "ORDER_NOT_FOUND" }, { status: 404 });
}
