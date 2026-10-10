/** Loads the repository root .env for CLI scripts (no-op when variables are already set). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env"), quiet: true });
