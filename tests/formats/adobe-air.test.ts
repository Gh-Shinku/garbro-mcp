import { BufferByteSource, extractArchive } from "@garbro-mcp/core";
import { airFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

const INDEX_MAGIC = Buffer.from([0x0a, 0x0b, 0x01]);
const NAME_MARKER = Buffer.from([0x09, 0x05, 0x01]);

/** Mirrors GARbro's `ReadInteger` encoding. */
function packInteger(value: number): number[] {
	if (value < 0x80) return [value];
	const bytes: number[] = [];
	let rest = value;
	while (rest >= 1 << 22) {
		bytes.unshift(rest & 0xff);
		rest >>>= 8;
	}
	bytes.unshift(rest & 0x7f);
	return bytes;
}

interface AirEntry {
	name: string;
	content: Buffer;
}

function buildAir(entries: readonly AirEntry[]): Buffer {
	const payloads = entries.map((entry) => deflateRawSync(entry.content));
	// Offsets depend on the compressed index length, which depends on the offsets, so the index is
	// rebuilt until its length stops changing.
	let indexSize = 0;
	let storedIndex = Buffer.alloc(0);
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const indexBytes: number[] = [...INDEX_MAGIC];
		let cursor = 4 + indexSize;
		for (const [id, entry] of entries.entries()) {
			const name = Buffer.from(entry.name, "utf8");
			indexBytes.push((name.length << 1) | 1, ...name, ...NAME_MARKER, 0x04);
			indexBytes.push(...packInteger(cursor));
			indexBytes.push(0x04);
			indexBytes.push(...packInteger(payloads[id]?.length ?? 0));
			cursor += payloads[id]?.length ?? 0;
		}
		indexBytes.push(0x01);
		storedIndex = deflateRawSync(Buffer.from(indexBytes));
		if (storedIndex.length === indexSize) break;
		indexSize = storedIndex.length;
	}
	const archive = Buffer.alloc(
		4 +
			storedIndex.length +
			payloads.reduce((sum, payload) => sum + payload.length, 0),
	);
	archive.writeUInt32BE(4, 0);
	storedIndex.copy(archive, 4);
	let position = 4 + storedIndex.length;
	for (const payload of payloads) {
		payload.copy(archive, position);
		position += payload.length;
	}
	return archive;
}

describe("Adobe AIR resource archive", () => {
	it("inflates the index and streams payloads", async () => {
		const first = Buffer.from("first payload contents");
		const second = Buffer.from("second");
		await expectArchive({
			format: airFormat,
			archive: buildAir([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.air",
			entries: [
				{
					path: "data/one.bin",
					size: deflateRawSync(first).length,
					content: first,
				},
				{
					path: "two.bin",
					size: deflateRawSync(second).length,
					content: second,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("extracts entries whose output size is undeclared", async () => {
		const content = Buffer.from("undeclared output size payload");
		const archive = await airFormat.open(
			new BufferByteSource(buildAir([{ name: "stream.bin", content }])),
			"sample.air",
		);
		const outputDirectory = await mkdtemp(
			resolve(tmpdir(), "garbro-air-test-"),
		);
		temporaryDirectories.push(outputDirectory);
		try {
			expect(archive.entries[0]).toMatchObject({
				path: "stream.bin",
				compressed: true,
				sizeKnown: false,
			});
			const extracted = await extractArchive(archive, { outputDirectory });
			expect(extracted.files[0]?.bytesWritten).toBe(BigInt(content.length));
			expect(
				await readFile(resolve(outputDirectory, "stream.bin"), "utf8"),
			).toBe(content.toString("utf8"));
		} finally {
			await archive.close();
		}
	});

	it("rejects an index offset beyond the file", async () => {
		const archive = buildAir([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32BE(archive.length + 16, 0);
		await expectArchive({
			format: airFormat,
			archive,
			sourcePath: "sample.air",
			detected: false,
			entries: [],
		});
	});

	it("rejects an invalid index", async () => {
		const archive = buildAir([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeInt32BE(0, 0);
		await expectArchive({
			format: airFormat,
			archive,
			sourcePath: "sample.air",
			detected: false,
			entries: [],
		});
	});
});
