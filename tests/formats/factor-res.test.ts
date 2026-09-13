import { BufferByteSource } from "@garbro-mcp/core";
import { factorResFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

/** Builds a pack archive: size-prefixed payloads back to back. */
function buildPack(payloads: readonly Buffer[]): Buffer {
	const chunks: Buffer[] = [];
	for (const payload of payloads) {
		const size = Buffer.alloc(4);
		size.writeUInt32LE(payload.length, 0);
		chunks.push(size, payload);
	}
	return Buffer.concat(chunks);
}

describe("Factor pack archives", () => {
	it("walks size prefixed payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload, longer");
		await expectArchive({
			format: factorResFormat,
			archive: buildPack([first, second]),
			sourcePath: "pack1",
			entries: [
				{ path: "pack1#0000", size: first.length, content: first },
				{ path: "pack1#0001", size: second.length, content: second },
			],
		});
	});

	it("lists a zero size entry", async () => {
		const data = Buffer.from("payload");
		const archive = Buffer.concat([
			Buffer.alloc(4),
			(() => {
				const size = Buffer.alloc(4);
				size.writeUInt32LE(data.length, 0);
				return Buffer.concat([size, data]);
			})(),
		]);
		await expectArchive({
			format: factorResFormat,
			archive,
			sourcePath: "pack2",
			entries: [
				{ path: "pack2#0000", size: 0, content: Buffer.alloc(0) },
				{ path: "pack2#0001", size: data.length, content: data },
			],
		});
	});

	it("rejects an archive whose name does not match", async () => {
		const archive = buildPack([Buffer.from("payload")]);
		for (const name of ["pack", "pack12", "packX", "sample"]) {
			const source = new BufferByteSource(archive);
			expect(await factorResFormat.detect(source, name)).toBe(false);
		}
	});

	it("rejects an archive that carries an extension", async () => {
		const archive = buildPack([Buffer.from("payload")]);
		const source = new BufferByteSource(archive);
		expect(await factorResFormat.detect(source, "pack1.res")).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildPack([Buffer.from("payload")]);
		archive.writeUInt32LE(0x1000, 0);
		const source = new BufferByteSource(archive);
		expect(await factorResFormat.detect(source, "pack1")).toBe(false);
	});

	it("rejects a truncated size field", async () => {
		const archive = buildPack([Buffer.from("payload")]);
		const source = new BufferByteSource(archive.subarray(0, 2));
		expect(await factorResFormat.detect(source, "pack1")).toBe(false);
	});
});
