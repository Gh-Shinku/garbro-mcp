import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gameSystemCgdImageFormat,
	readCgdLayout,
	unpackCgd,
} from "../../packages/formats/src/gamesystem/cgd-image.js";

const HEADER_SIZE = 0x10;

/** A file whose first word is its own length, with the measurements behind it. */
function cgdFile(
	stream: Buffer,
	options: { width?: number; height?: number; declared?: number } = {},
): Buffer {
	const head = Buffer.alloc(HEADER_SIZE);
	head.writeUInt32LE(options.declared ?? HEADER_SIZE + stream.length, 0);
	head.writeUInt32LE(options.width ?? 2, 4);
	head.writeUInt32LE(options.height ?? 1, 8);
	return Buffer.concat([head, stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await gameSystemCgdImageFormat.open(
		new BufferByteSource(data),
		"pic.cgd",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("GameSystem CG picture", () => {
	it("reads a head that declares the file's own length", () => {
		expect(readCgdLayout(cgdFile(Buffer.alloc(3)))).toEqual({
			width: 2,
			height: 1,
		});
		// The head may be left out of the declared length.
		const withoutHead = cgdFile(Buffer.alloc(3), {
			declared: 3,
		});
		expect(readCgdLayout(withoutHead)).toEqual({ width: 2, height: 1 });
	});

	it("declines a head whose length or measurements do not stand", async () => {
		const data = cgdFile(Buffer.alloc(3));
		expect(readCgdLayout(data)).toBeDefined();
		const wrongLength = cgdFile(Buffer.alloc(3), { declared: 5 });
		expect(readCgdLayout(wrongLength)).toBeUndefined();
		expect(
			await gameSystemCgdImageFormat.detect(
				new BufferByteSource(wrongLength),
				"pic.cgd",
			),
		).toBe(false);
		const empty = cgdFile(Buffer.alloc(3), { width: 0 });
		expect(readCgdLayout(empty)).toBeUndefined();
		const huge = cgdFile(Buffer.alloc(3), { width: 0x8001 });
		expect(readCgdLayout(huge)).toBeUndefined();
	});

	it("reports the measurements of the picture", async () => {
		const handle = await gameSystemCgdImageFormat.open(
			new BufferByteSource(cgdFile(Buffer.alloc(6), { width: 4, height: 2 })),
			"dir/pic.cgd",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 2,
			bitsPerPixel: 24,
		});
	});

	it("walks signed colour steps and repeats them", async () => {
		// The word of a step is the control byte above the byte behind it, and the colour table entry it names
		// holds one step of one in every channel.
		const stream = Buffer.from([0x04, 0x21, 0x80]);
		const layout = readCgdLayout(cgdFile(stream));
		if (!layout) throw new Error("no layout");
		expect(unpackCgd(cgdFile(stream), layout).toString("hex")).toBe(
			"010101010101",
		);
		const out = await extract(cgdFile(stream));
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(54).toString("hex")).toBe("010101" + "010101" + "0000");
	});

	it("repeats the colour as it stands", () => {
		const stream = Buffer.from([0x04, 0x21, 0x81]);
		const file = cgdFile(stream, { width: 3 });
		const layout = readCgdLayout(file);
		if (!layout) throw new Error("no layout");
		expect(unpackCgd(file, layout).toString("hex")).toBe("010101010101010101");
	});

	it("reads the pixels that stand in the stream themselves", () => {
		const stream = Buffer.from([0xc1, 1, 2, 3, 4, 5, 6]);
		const layout = readCgdLayout(cgdFile(stream));
		if (!layout) throw new Error("no layout");
		expect(unpackCgd(cgdFile(stream), layout).toString("hex")).toBe(
			"010203040506",
		);
		// And the walk goes on from the colour of the last of them.
		const longer = Buffer.from([0xc1, 1, 2, 3, 4, 5, 6, 0x80]);
		const wide = readCgdLayout(cgdFile(longer, { width: 3 }));
		if (!wide) throw new Error("no layout");
		expect(unpackCgd(cgdFile(longer, { width: 3 }), wide).toString("hex")).toBe(
			"010203040506040506",
		);
	});

	it("ends the walk at the delimiter", () => {
		const stream = Buffer.from([0xff]);
		const layout = readCgdLayout(cgdFile(stream));
		if (!layout) throw new Error("no layout");
		expect(unpackCgd(cgdFile(stream), layout).toString("hex")).toBe(
			"000000000000",
		);
	});

	it("refuses a command that writes past the picture", async () => {
		const stream = Buffer.from([0xc1, 1, 2, 3, 4, 5, 6]);
		const layout = readCgdLayout(cgdFile(stream, { width: 1 }));
		if (!layout) throw new Error("no layout");
		expect(() => unpackCgd(cgdFile(stream, { width: 1 }), layout)).toThrow(
			GarbroError,
		);
		expect(() => unpackCgd(cgdFile(stream, { width: 1 }), layout)).toThrow(
			"past its own end",
		);
	});
});
