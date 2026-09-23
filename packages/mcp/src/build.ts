declare const GARBRO_MCP_VERSION: string;
declare const GARBRO_MCP_GIT_COMMIT: string;
declare const GARBRO_MCP_BUILT_AT: string;
declare const GARBRO_MCP_BUILD_ID: string;
declare const GARBRO_MCP_FORMAT_CATALOG_SHA256: string;
declare const GARBRO_MCP_BUILD_DIRTY: boolean;

export const MCP_PROTOCOL_VERSION = "6";

export interface BuildIdentity {
	version: string;
	gitCommit: string;
	builtAt: string;
	buildId: string;
	formatCatalogSha256: string;
	dirty: boolean;
	protocolVersion: string;
}

export const BUILD_IDENTITY: Readonly<BuildIdentity> = Object.freeze({
	version:
		typeof GARBRO_MCP_VERSION === "string" ? GARBRO_MCP_VERSION : "0.0.0-dev.0",
	gitCommit:
		typeof GARBRO_MCP_GIT_COMMIT === "string"
			? GARBRO_MCP_GIT_COMMIT
			: "development",
	builtAt:
		typeof GARBRO_MCP_BUILT_AT === "string"
			? GARBRO_MCP_BUILT_AT
			: "development",
	buildId:
		typeof GARBRO_MCP_BUILD_ID === "string"
			? GARBRO_MCP_BUILD_ID
			: "development",
	formatCatalogSha256:
		typeof GARBRO_MCP_FORMAT_CATALOG_SHA256 === "string"
			? GARBRO_MCP_FORMAT_CATALOG_SHA256
			: "development",
	dirty:
		typeof GARBRO_MCP_BUILD_DIRTY === "boolean" ? GARBRO_MCP_BUILD_DIRTY : true,
	protocolVersion: MCP_PROTOCOL_VERSION,
});
