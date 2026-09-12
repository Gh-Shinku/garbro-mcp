import { BufferByteSource } from "@garbro-mcp/core";
import { spcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, expect, it } from "vitest";

function u32(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value, 0);
	return buffer;
}

function record(offset: number, size: number): Buffer {
	return Buffer.concat([u32(offset), u32(size), Buffer.alloc(8)]);
}

function xtx(fill: number): Buffer {
	return Buffer.concat([u32(0x00787478), Buffer.alloc(0x20, fill)]);
}

/**
 * Builds a two-level index: the root lists one xtx and one subdirectory, and the subdirectory
 * lists a second xtx. Record offsets are relative to the start of each index.
 */
function buildIndex(): {
	index: Buffer;
	entries: { path: string; content: Buffer }[];
} {
	const rootXtx = xtx(0x41);
	const subXtx = xtx(0x42);
	const subIndex = Buffer.concat([record(0x10, subXtx.length), subXtx]);
	const rootOffset = 0x20;
	const subOffset = rootOffset + rootXtx.length;
	const root = Buffer.concat([
		record(rootOffset, rootXtx.length),
		record(subOffset, subIndex.length),
		rootXtx,
		subIndex,
	]);
	return {
		index: root,
		entries: [
			{ path: "data#0000.xtx", content: rootXtx },
			{ path: "0001/data#0001.xtx", content: subXtx },
		],
	};
}

describe("CRI SPC texture container", () => {
	it("walks nested xtx indexes from the decompressed stream", async () => {
		const fixture = buildIndex();
		const archive = Buffer.concat([
			u32(fixture.index.length),
			literalLzssStream(fixture.index),
		]);
		await expectArchive({
			format: spcFormat,
			archive,
			sourcePath: "data.spc",
			entries: fixture.entries.map((entry) => ({
				path: entry.path,
				size: entry.content.length,
				content: entry.content,
			})),
			metadata: { entryCount: 2, unpackedSize: fixture.index.length },
		});
	});

	it("rejects a nested index whose first offset is not aligned", async () => {
		const fixture = buildIndex();
		fixture.index.writeUInt32LE(0x11, 0x10);
		const archive = Buffer.concat([
			u32(fixture.index.length),
			literalLzssStream(fixture.index),
		]);
		await expect(
			spcFormat.open(new BufferByteSource(archive), "data.spc"),
		).rejects.toThrow(/aligned|invalid/);
	});
});
