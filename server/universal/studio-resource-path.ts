import { homedir } from "node:os";
import * as path from "node:path";

/** Application-owned source configuration; never an agent's authentication home. */
export function getStudioResourcesDir(): string {
  const directory = process.env.ACP_STUDIO_RESOURCES_DIR;
  if (directory && !path.isAbsolute(directory)) throw new Error("ACP_STUDIO_RESOURCES_DIR must be absolute");
  return directory || path.join(homedir(), ".acp-client");
}
