import type { PGlite } from "@electric-sql/pglite";

const ident = (value: string) => {
  if (!/^[a-z_]+$/.test(value)) throw new Error("Invalid test SQL identifier");
  return `"${value}"`;
};

/** Run the worker's PostgREST-shaped queries against the real local PostgreSQL
 * engine. Only the network adapter is replaced, not the application SQL. */
export function pgApi(db: PGlite) {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (name === "story_ai_key")
        return { data: "mock-provider-key", error: null };
      try {
        const parameters = Object.keys(args)
          .map((key, i) => `${ident(key)} => $${i + 1}`)
          .join(",");
        const rows = await db.query<{ data: unknown }>(
          `select public.${ident(name)}(${parameters}) as data`,
          Object.values(args),
        );
        return { data: rows.rows[0].data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table: string) {
      const values: unknown[] = [],
        filters: string[] = [],
        orders: string[] = [];
      let columns = "*",
        limit: number | undefined,
        update: Record<string, unknown> | undefined;
      let single = false;
      const parameter = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      const filter = (key: string, op: string, value: unknown) => {
        filters.push(`${ident(key)} ${op} ${parameter(value)}`);
        return query;
      };
      const query = {
        select(value: string) {
          columns = value === "*" ? "*" : value.split(",").map(ident).join(",");
          return query;
        },
        eq: (key: string, value: unknown) => filter(key, "=", value),
        gt: (key: string, value: unknown) => filter(key, ">", value),
        lte: (key: string, value: unknown) => filter(key, "<=", value),
        in(key: string, list: unknown[]) {
          filters.push(`${ident(key)} in (${list.map(parameter).join(",")})`);
          return query;
        },
        order(key: string, { ascending }: { ascending: boolean }) {
          orders.push(`${ident(key)} ${ascending ? "asc" : "desc"}`);
          return query;
        },
        limit(value: number) {
          limit = value;
          return query;
        },
        update(value: Record<string, unknown>) {
          update = value;
          return query;
        },
        single() {
          single = true;
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        async then(
          resolve: (result: { data: any; error: any }) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          try {
            const where = filters.length
              ? ` where ${filters.join(" and ")}`
              : "";
            const sql = update
              ? `update public.${ident(table)} set ${Object.entries(update)
                  .map(([key, value]) => `${ident(key)}=${parameter(value)}`)
                  .join(",")}${where} returning ${columns}`
              : `select ${columns} from public.${ident(table)}${where}${orders.length ? ` order by ${orders.join(",")}` : ""}${limit === undefined ? "" : ` limit ${limit}`}`;
            const result = await db.query(sql, values);
            return resolve({
              data: single ? result.rows[0] || null : result.rows,
              error: null,
            });
          } catch (error) {
            return resolve({ data: null, error });
          }
        },
      };
      return query;
    },
  };
}
