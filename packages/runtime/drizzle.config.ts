import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/platform/storage/sqlite-schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "./.eragear/eragear.sqlite",
  },
});
