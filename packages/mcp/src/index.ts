#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./server.js";

void serveStdio(() => buildServer());
console.error("garbro-mcp server running on stdio");
