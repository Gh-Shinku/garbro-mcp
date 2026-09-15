import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { scoopScpImageFormat } from "../../packages/formats/src/scoop/scp-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const HEADER_KEY = 0x65641538;
/** A control word carries thirty one opcodes: the last bit of one is spent on the way into the next. */
const OPS_PER_WORD = 31;

interface Op {
	bit: number;
	data: Buffer;
}

/**
 * The stream the reference reads: every opcode stands behind a control word of its own, and the bits of a word
 * are read from its highest one down.
 */
class ScpWriter {
	private readonly ops: Op[] = [];
	private key = 0x7f;
	private previousKey = 0;

	literals(bytes: Buffer | number[]): this {
		for (const byte of bytes) {
			const value = byte & 0xff;
			this.ops.push({
				bit: 0,
				data: Buffer.from([(this.key ^ value) & 0xff]),
			});
			this.previousKey = this.key;
			this.key = value;
		}
		return this;
	}

	/** A run of three to seventeen bytes, the length of which rides in the word of the opcode. */
	run(distance: number, count: number): this {
		const word = Buffer.alloc(2);
		word.writeUInt16LE(
			(((count - 2) << 12) | ((distance - 1) & 0xfff)) & 0xffff,
			0,
		);
		this.ops.push({ bit: 1, data: word });
		return this;
	}

	/** A longer run, where the byte behind the word is what the previous key leaves of the length. */
	longRun(distance: number, count: number): this {
		const data = Buffer.alloc(3);
		data.writeUInt16LE((distance - 1) & 0xfff, 0);
		data.writeUInt8((count - 17 - this.previousKey) & 0xff, 2);
		this.ops.push({ bit: 1, data });
		return this;
	}

	done(): Buffer {
		const parts: Buffer[] = [];
		for (let i = 0; i < this.ops.length; i += OPS_PER_WORD) {
			const group = this.ops.slice(i, i + OPS_PER_WORD);
			// The last bit of a control word is spent on the way into the next one, so a word of nothing but
			// literals carries a one there, which is what keeps the decoder reading words rather than repeats.
			let control = 1;
			for (const [index, op] of group.entries()) {
				if (op.bit) control |= 1 << (OPS_PER_WORD - index);
			}
			const word = Buffer.alloc(4);
			word.writeUInt32LE(control >>> 0, 0);
			parts.push(word);
			for (const op of group) parts.push(op.data);
		}
		return Buffer.concat(parts);
	}
}

/** A `SCPz` file whose header declares the length of the picture the body unfolds into. */
function scpFile(unpackedSize: number, body: Buffer): Buffer {
	const header = Buffer.alloc(8, 0);
	header.write("SCPz", 0, "latin1");
	header.writeUInt32LE((unpackedSize ^ HEADER_KEY) >>> 0, 4);
	return Buffer.concat([header, body]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await scoopScpImageFormat.open(sourceOf(data), "cg.scp");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe("Scoop compressed bitmap", () => {
	it("finds a picture whose stream unfolds to a bitmap", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new ScpWriter();
		writer.literals(bmp);
		expect(
			await scoopScpImageFormat.detect(
				sourceOf(scpFile(bmp.length, writer.done())),
			),
		).toBe(true);
		// A length of nothing, and a stream that unfolds to something other than a bitmap.
		expect(
			await scoopScpImageFormat.detect(
				sourceOf(scpFile(0, Buffer.from([0, 0, 0, 0x80, 0, 0]))),
			),
		).toBe(false);
		const other = new ScpWriter();
		other.literals(Buffer.from("XX"));
		expect(
			await scoopScpImageFormat.detect(sourceOf(scpFile(2, other.done()))),
		).toBe(false);
	});

	it("lists the picture with the measurements of its bitmap", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new ScpWriter();
		writer.literals(bmp);
		const handle = await scoopScpImageFormat.open(
			sourceOf(scpFile(bmp.length, writer.done())),
			"dir/cg.scp",
		);
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			unpackedSize: bmp.length,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "scoop-lz",
		});
	});

	it("writes the bitmap its stream unfolds to", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new ScpWriter();
		writer.literals(bmp);
		const out = await extract(scpFile(bmp.length, writer.done()));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("repeats a run of what the picture already holds", async () => {
		// The header of a picture of two pixels, one pixel the stream carries, then three more bytes copied
		// from the three behind them, and the two bytes a row of a bitmap is padded with.
		const picture = writeBmp24(2, 1, Buffer.from([1, 2, 3, 1, 2, 3]));
		const writer = new ScpWriter();
		writer
			.literals(picture.subarray(0, 54))
			.literals([1, 2, 3])
			.run(3, 3)
			.literals([0, 0]);
		const out = await extract(scpFile(picture.length, writer.done()));
		expect(out.subarray(54, 54 + 8)).toEqual(
			Buffer.from([1, 2, 3, 1, 2, 3, 0, 0]),
		);
	});

	it("counts a run longer than seventeen with the byte behind its word", async () => {
		// A picture four pixels across, so that a row of it is already a whole number of words, and a run of
		// twenty one bytes, which the word of the opcode cannot name on its own.
		const picture = writeBmp24(4, 2, Buffer.alloc(24, 0x00));
		const writer = new ScpWriter();
		writer.literals(picture.subarray(0, 54));
		writer.literals([9, 9, 9]).longRun(3, 21);
		const out = await extract(scpFile(picture.length, writer.done()));
		expect(out.subarray(54, 54 + 24)).toEqual(Buffer.alloc(24, 0x09));
	});

	it("refuses a run that reaches back before its picture", async () => {
		// A run counting back further than the picture has come.
		const picture = writeBmp24(2, 1, Buffer.alloc(6, 0x00));
		const writer = new ScpWriter();
		writer.literals(picture.subarray(0, 54));
		writer.run(0x40, 3);
		await expect(
			extract(scpFile(picture.length, writer.done())),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a stream that stops before the picture is whole", async () => {
		const picture = writeBmp24(2, 1, Buffer.alloc(6, 0x00));
		const writer = new ScpWriter();
		writer.literals(picture.subarray(0, 54));
		await expect(
			extract(scpFile(picture.length, writer.done())),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a stream that ends inside an opcode", async () => {
		// A run whose word is there but whose length byte is not.
		const picture = writeBmp24(2, 1, Buffer.alloc(6, 0x00));
		const writer = new ScpWriter();
		writer.literals(picture.subarray(0, 54));
		const control: Buffer = Buffer.alloc(4, 0);
		control.writeUInt32LE(0xc0000001, 0);
		await expect(
			extract(
				scpFile(
					picture.length,
					Buffer.concat([writer.done(), control, Buffer.from([0x02, 0x00])]),
				),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
