import "dotenv/config";
import { defineConfig } from "prisma/config";

const generationUrl = process.env.DATABASE_URL?.trim() || "postgresql://chainward:chainward@localhost:5432/chainward?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: generationUrl,
  },
});
