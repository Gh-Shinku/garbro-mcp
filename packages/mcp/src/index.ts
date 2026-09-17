#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { parseArgs } from "node:util";
import { buildServer, SERVER_VERSION } from "./server.js";

const { values } = parseArgs({
	options: {
		"input-root": { type: "string", multiple: true },
		"output-root": { type: "string" },
		help: { type: "boolean", short: "h" },
		version: { type: "boolean", short: "v" },
	},
});

if (values.help) {
	console.error(`Usage: garbro-mcp-server [options]

Options:
  --input-root <id=path>  Add a named readable root (repeatable)
  --output-root <path>    Set the only writable extraction root
  -v, --version           Show the server version
  -h, --help              Show this help`);
	process.exit(0);
}

if (values.version) {
	console.log(SERVER_VERSION);
	process.exit(0);
}

const inputRoots = values["input-root"]?.reduce<Record<string, string>>(
	(roots, declaration) => {
		const separator = declaration.indexOf("=");
		if (separator <= 0 || separator === declaration.length - 1)
			throw new Error(`Invalid --input-root value: ${declaration}`);
		const id = declaration.slice(0, separator);
		if (roots[id] !== undefined)
			throw new Error(`Duplicate --input-root ID: ${id}`);
		roots[id] = declaration.slice(separator + 1);
		return roots;
	},
	Object.create(null) as Record<string, string>,
);

void serveStdio(() =>
	buildServer({
		...(inputRoots === undefined ? {} : { inputRoots }),
		...(values["output-root"] === undefined
			? {}
			: { outputRoot: values["output-root"] }),
	}),
);
console.error("garbro-mcp server running on stdio");
