import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceMigrations = resolve(projectRoot, "src/database/migrations");
const outputMigrations = resolve(projectRoot, "dist/database/migrations");

rmSync(outputMigrations, { recursive: true, force: true });
mkdirSync(dirname(outputMigrations), { recursive: true });
cpSync(sourceMigrations, outputMigrations, { recursive: true });
