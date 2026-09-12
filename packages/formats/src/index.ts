import { FormatRegistry } from "@garbro-mcp/core";
import { Adpack32Format } from "./active-soft/adpack32.js";
import { Xp3Format } from "./xp3/format.js";

export * from "./active-soft/index.js";
export * from "./xp3/index.js";

export function createDefaultRegistry(): FormatRegistry {
	return new FormatRegistry([new Xp3Format(), new Adpack32Format()]);
}
