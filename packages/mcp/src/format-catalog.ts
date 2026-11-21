import type { FormatRegistry } from "@garbro-mcp/core";
import {
	type McpServer,
	ProtocolError,
	ProtocolErrorCode,
	type ReadResourceTemplateCallback,
	ResourceTemplate,
} from "@modelcontextprotocol/server";
import { MAX_RESPONSE_BYTES } from "./context.js";
import { DEFAULT_PAGE_BYTES, responseBodyBudget } from "./result-page.js";

const root = "garbro://formats";
const mimeType = "application/json";

function resource(uri: URL, payload: unknown) {
	return {
		contents: [{ uri: uri.href, mimeType, text: JSON.stringify(payload) }],
	};
}

export function registerFormatCatalog(
	server: McpServer,
	registry: FormatRegistry,
	support: ReadonlyMap<string, unknown>,
) {
	function listing(
		uri: URL,
		requestId: number | string,
		offsetText = "0",
		extension?: string,
	) {
		const formats =
			extension === undefined
				? registry.listFormats()
				: registry.listFormatsForExtension(extension);
		const offset = Number(offsetText);
		if (
			!/^(0|[1-9]\d*)$/.test(offsetText) ||
			!Number.isSafeInteger(offset) ||
			(offset > 0 && offset >= formats.length)
		)
			throw new ProtocolError(
				ProtocolErrorCode.InvalidParams,
				"Invalid format catalog page offset",
			);
		const base =
			extension === undefined
				? root
				: `${root}/by-extension/${encodeURIComponent(extension)}`;
		const budget = responseBodyBudget(DEFAULT_PAGE_BYTES, requestId);
		const summaries = [];
		let response = resource(uri, {
			total: formats.length,
			formats: [],
			nextUri: null,
		});
		for (let i = offset; i < formats.length; i++) {
			const format = formats[i];
			if (!format) break;
			summaries.push({
				id: format.id,
				name: format.name,
				extensions: format.extensions,
				detailUri: `${root}/by-id/${encodeURIComponent(format.id)}`,
			});
			const page = resource(uri, {
				total: formats.length,
				formats: summaries,
				nextUri: i + 1 < formats.length ? `${base}/page/${i + 1}` : null,
			});
			if (Buffer.byteLength(JSON.stringify(page)) > budget) {
				if (i === offset)
					throw new ProtocolError(
						ProtocolErrorCode.InvalidParams,
						"Format summary exceeds the page budget",
					);
				break;
			}
			response = page;
		}
		return response;
	}
	server.registerResource(
		"format-catalog",
		root,
		{
			title: "Format catalog",
			description:
				"Paged summaries. Follow nextUri or detailUri, or look up a reader by extension.",
			mimeType,
		},
		(uri, ctx) => listing(uri, ctx.mcpReq.id),
	);
	const readPage: ReadResourceTemplateCallback = (uri, vars, ctx) => {
		if (
			(vars.offset !== undefined && typeof vars.offset !== "string") ||
			(vars.extension !== undefined && typeof vars.extension !== "string")
		)
			throw new ProtocolError(
				ProtocolErrorCode.InvalidParams,
				"Expected a single extension and offset",
			);
		const ext = vars.extension?.replace(/^\./, "").toLowerCase();
		if (ext !== undefined && (!ext || ext.length > 128))
			throw new ProtocolError(
				ProtocolErrorCode.InvalidParams,
				"Invalid extension",
			);
		return listing(uri, ctx.mcpReq.id, vars.offset, ext);
	};
	for (const [name, path, title] of [
		["format-page", "/page/{offset}", "Format catalog page"],
		[
			"formats-by-extension",
			"/by-extension/{extension}",
			"Readers for a file extension, including aliases",
		],
		[
			"format-extension-page",
			"/by-extension/{extension}/page/{offset}",
			"Next page of readers for a file extension",
		],
	] as const)
		server.registerResource(
			name,
			new ResourceTemplate(root + path, { list: undefined }),
			{ title, mimeType },
			readPage,
		);
	server.registerResource(
		"format-by-id",
		new ResourceTemplate(`${root}/by-id/{id}`, { list: undefined }),
		{ title: "Format details by ID", mimeType },
		(uri, vars, ctx) => {
			const format = registry.listFormats().find((row) => row.id === vars.id);
			if (!format)
				throw new ProtocolError(
					ProtocolErrorCode.ResourceNotFound,
					"Unknown format ID",
				);
			const response = resource(uri, {
				id: format.id,
				name: format.name,
				extensions: format.extensions,
				capabilities: format.capabilities,
				attribution: format.attribution,
				support: support.get(format.id),
			});
			if (
				Buffer.byteLength(JSON.stringify(response)) >
				responseBodyBudget(MAX_RESPONSE_BYTES, ctx.mcpReq.id)
			)
				throw new ProtocolError(
					ProtocolErrorCode.InvalidParams,
					"Format detail exceeds the resource budget",
				);
			return response;
		},
	);
}
