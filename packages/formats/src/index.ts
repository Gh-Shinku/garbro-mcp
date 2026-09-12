import { FormatRegistry } from "@garbro-mcp/core";
import { Xp3Format } from "./xp3/format.js";

export * from "./xp3/index.js";

export function createDefaultRegistry(): FormatRegistry {
	return new FormatRegistry([new Xp3Format()]);
}
