// The resources of a Windows executable (GARbro "Experimental/Microsoft/ArcEXE.cs", class ExeOpener),
// against an image built in the test: a minimal 32 bit image whose one `.rsrc` section carries three
// resources, two of a kind the reference holds a name and an extension for and one of a kind it does not.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import {
	EXECUTABLE_EXTENSION_TYPE_MAP,
	EXECUTABLE_RUNTIME_TYPE_MAP,
	executableResourceId,
	executableResourcesFormat,
	wrapExecutableBitmap,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { buffer as consumeBuffer } from "node:stream/consumers";

/** A minimal image whose `.rsrc` section carries the resources given, of the kinds given. */
function executableWith(resources: { kind: number; data: Buffer }[]): Buffer {
	const count = resources.length;
	const kindAt = 0x10 + 8 * count;
	const nameAt = kindAt + count * 0x20;
	const dataAt = nameAt + count * 0x20;
	const bodyAt = dataAt + count * 0x10;
	const tree = Buffer.alloc(0x1000, 0x00);
	tree.writeUInt16LE(0, 0x0c); // the root stands of entries of numbers
	tree.writeUInt16LE(count, 0x0e);
	for (let at = 0; at < count; at += 1) {
		// The kind of the resource, and the directory of the names of that kind behind it.
		tree.writeUInt32LE(resources[at]?.kind ?? 0, 0x10 + at * 8);
		tree.writeUInt32LE(
			(0x80000000 | (kindAt + at * 0x20)) >>> 0,
			0x14 + at * 8,
		);
		// The one name of the kind, of a number, and the place of the resource itself behind it.
		tree.writeUInt16LE(0, kindAt + at * 0x20 + 0x0c);
		tree.writeUInt16LE(1, kindAt + at * 0x20 + 0x0e);
		tree.writeUInt32LE(1, kindAt + at * 0x20 + 0x10);
		tree.writeUInt32LE(
			(0x80000000 | (nameAt + at * 0x20)) >>> 0,
			kindAt + at * 0x20 + 0x14,
		);
		// The one language of the name, and the place of the resource itself.
		tree.writeUInt16LE(0, nameAt + at * 0x20 + 0x0c);
		tree.writeUInt16LE(1, nameAt + at * 0x20 + 0x0e);
		tree.writeUInt32LE(0x409, nameAt + at * 0x20 + 0x10);
		tree.writeUInt32LE(dataAt + at * 0x10, nameAt + at * 0x20 + 0x14);
		tree.writeUInt32LE(0x1000 + bodyAt + at * 0x40, dataAt + at * 0x10);
		tree.writeUInt32LE(resources[at]?.data.length ?? 0, dataAt + at * 0x10 + 4);
		resources[at]?.data.copy(tree, bodyAt + at * 0x40);
	}
	const headers = Buffer.alloc(0x200, 0x00);
	headers.write("MZ", 0, "ascii");
	headers.writeUInt32LE(0x40, 0x3c);
	headers.write("PE\0\0", 0x40, "binary");
	headers.writeUInt16LE(1, 0x40 + 6);
	headers.writeUInt16LE(0xe0, 0x40 + 0x14);
	const optional = 0x40 + 0x18;
	headers.writeUInt16LE(0x010b, optional);
	headers.writeUInt32LE(0x200, optional + 0x3c);
	headers.writeUInt32LE(0x1000, optional + 0x60 + 0x10);
	headers.writeUInt32LE(tree.length, optional + 0x60 + 0x14);
	const section = optional + 0xe0;
	headers.write(".rsrc", section, "latin1");
	headers.writeUInt32LE(tree.length, section + 8);
	headers.writeUInt32LE(0x1000, section + 0x0c);
	headers.writeUInt32LE(0x200, section + 0x14);
	return Buffer.concat([headers, tree]);
}

describe("Windows executable resources", () => {
	it("reads the two tables of names of the reference as they stand there", () => {
		// Every kind of resource the reference holds a directory for and every extension it holds, read
		// off `ArcEXE.cs` itself rather than retyped.
		expect(EXECUTABLE_RUNTIME_TYPE_MAP).toEqual({
			"#2": "RT_BITMAP",
			"#10": "RT_RCDATA",
			"#16": "RT_VERSION",
		});
		expect(EXECUTABLE_EXTENSION_TYPE_MAP).toEqual({
			PNG: ".PNG",
			WAVE: ".WAV",
			MIDS: ".MID",
			SCR: ".BIN",
			"#2": ".BMP",
			"#10": ".BIN",
		});
	});

	it("reads the places of a resource of the engine", () => {
		expect(executableResourceId("#2")).toBe("00002");
		expect(executableResourceId("#1033")).toBe("01033");
		expect(executableResourceId("RT_BITMAP")).toBe("RT_BITMAP");
		// The head of a bitmap of the engine: the word `BM`, the count of the places of the file and the
		// count of the places of the picture behind them.
		const head = Buffer.alloc(0x30, 0x00);
		head.writeUInt32LE(0x28, 0); // the counts of the places of the head of the picture
		const bitmap = wrapExecutableBitmap(head);
		expect(bitmap.toString("latin1", 0, 2)).toBe("BM");
		expect(bitmap.readUInt32LE(2)).toBe(14 + head.length);
		// The counts of the places of the picture itself stand at nought, so the places of the picture
		// stand behind the head of the picture, of the counts the head itself names.
		expect(bitmap.readUInt32LE(10)).toBe(14 + 0x28);
	});

	it("reads the files of an executable, of the tables of the engine", async () => {
		const picture = Buffer.alloc(0x40, 0x11);
		picture.writeUInt32LE(0x28, 0); // the counts of the head of the picture of the resource
		// The counts of the places of the picture itself, of the places of the *bitmap* the head of which
		// stands of the places of the file of the picture: the head of the file of a bitmap stands of the
		// fourteen places the reference puts in front of a resource here.
		picture.writeUInt32LE(0x20, 0x22 - 14);
		const file = executableWith([
			{ kind: 2, data: picture },
			{ kind: 10, data: Buffer.from("ARCHIVE", "latin1") },
			{ kind: 6, data: Buffer.from("MANIFEST", "latin1") },
		]);
		const source = new BufferByteSource(file);
		expect(
			await executableResourcesFormat.detect(source, "/tmp/sample.exe"),
		).toBe(true);
		const handle = await executableResourcesFormat.open(
			source,
			"/tmp/sample.exe",
		);
		try {
			// A kind of a resource the reference holds no name for stands of no file of the listing.
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"RT_BITMAP/00001.BMP",
				"RT_RCDATA/00001.BIN",
			]);
			const bitmap = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect(bitmap.toString("latin1", 0, 2)).toBe("BM");
			expect(bitmap.readUInt32LE(2)).toBe(14 + picture.length);
			expect(bitmap.readUInt32LE(10)).toBe(14 + picture.readInt32LE(0x22 - 14));
			expect([...bitmap.subarray(14, 18)]).toEqual([0x28, 0x00, 0x00, 0x00]);
			// A resource of any other kind stands of the places of the file itself.
			const data = await consumeBuffer(
				await handle.openEntry(handle.entries[1]?.id ?? "1"),
			);
			expect(data.toString("latin1")).toBe("ARCHIVE");
		} finally {
			await handle.close();
		}
	});

	it("reads no executable of no resource at all, and no file of another kind", async () => {
		const none = executableWith([]);
		const source = new BufferByteSource(none);
		expect(
			await executableResourcesFormat.detect(source, "/tmp/none.exe"),
		).toBe(false);
		const other = new BufferByteSource(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
		expect(
			await executableResourcesFormat.detect(other, "/tmp/other.bin"),
		).toBe(false);
	});
});
