import { encodeCp932 } from "@garbro-mcp/core";
import { fgaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_BLOCK_SIZE = 0x318;
const RECORD_SIZE = 0x18;

/** Packs bits most-significant-first, matching GARbro's `MsbBitStream`. */
function packBits(bits: readonly number[]): Buffer {
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (bit === 0) continue;
		const byte = Math.floor(index / 8);
		output[byte] = (output[byte] ?? 0) | (1 << (7 - (index % 8)));
	}
	return output;
}

function leaf(value: number): number[] {
	return [0, ...value.toString(2).padStart(8, "0").split("").map(Number)];
}

/** A Huffman stream whose root selects 'A' on a zero bit and 'B' on a one bit. */
function huffmanStream(bits: readonly number[]): Buffer {
	return packBits([1, ...leaf(0x41), ...leaf(0x42), ...bits]);
}

interface Block {
	records: {
		name?: string;
		offset?: number;
		size?: number;
		chainTo?: number;
	}[];
}

function buildFga(
	blocks: readonly Block[],
	payloads: readonly Buffer[],
): Buffer {
	// Blocks are laid out first so record offsets can point at the payloads behind them.
	const blockOffsets: number[] = [];
	let cursor = 0;
	for (let index = 0; index < blocks.length; index += 1) {
		blockOffsets.push(cursor);
		cursor += INDEX_BLOCK_SIZE;
	}
	const payloadOffset = cursor;
	const offsets: number[] = [];
	let running = 0;
	for (const payload of payloads) {
		offsets.push(payloadOffset + running);
		running += payload.length;
	}
	const archive = Buffer.alloc(
		payloadOffset + payloads.reduce((sum, payload) => sum + payload.length, 0),
	);
	for (const [blockIndex, block] of blocks.entries()) {
		const base = blockOffsets[blockIndex] ?? 0;
		for (const [recordIndex, record] of block.records.entries()) {
			const position = base + recordIndex * RECORD_SIZE;
			if (record.chainTo !== undefined) {
				archive[position] = 0xff;
				archive.writeUInt32LE(
					blockOffsets[record.chainTo] ?? 0,
					position + 0x0c,
				);
				continue;
			}
			encodeCp932(record.name ?? "").copy(archive, position);
			archive.writeUInt32LE(offsets[record.offset ?? 0] ?? 0, position + 0x0c);
			archive.writeUInt32LE(record.size ?? 0, position + 0x10);
		}
	}
	let position = payloadOffset;
	for (const payload of payloads) {
		payload.copy(archive, position);
		position += payload.length;
	}
	return archive;
}

describe("SFA engine FGA archive", () => {
	it("reads chained index blocks and decodes packed scripts", async () => {
		const plain = Buffer.from("plain payload");
		const script = Buffer.alloc(4);
		const scriptBody = huffmanStream([0, 1]);
		script.writeUInt32LE(2, 0);
		const packed = Buffer.concat([script, scriptBody]);
		const tail = Buffer.from("tail payload");
		await expectArchive({
			format: fgaFormat,
			archive: buildFga(
				[
					{
						records: [
							{ name: "data.dat", offset: 0, size: plain.length },
							{ name: "script.scr", offset: 1, size: packed.length },
							{ chainTo: 1 },
						],
					},
					{ records: [{ name: "tail.dat", offset: 2, size: tail.length }] },
				],
				[plain, packed, tail],
			),
			sourcePath: "sample.fga",
			entries: [
				{ path: "data.dat", size: plain.length, content: plain },
				{ path: "script.scr", size: 2, content: Buffer.from("AB") },
				{ path: "tail.dat", size: tail.length, content: tail },
			],
		});
	});

	it("stops at a zero first byte", async () => {
		const plain = Buffer.from("only payload");
		await expectArchive({
			format: fgaFormat,
			archive: buildFga(
				[
					{
						records: [{ name: "only.dat", offset: 0, size: plain.length }, {}],
					},
				],
				[plain],
			),
			sourcePath: "sample.fga",
			entries: [{ path: "only.dat", size: plain.length, content: plain }],
		});
	});

	it("requires the fga extension", async () => {
		const plain = Buffer.from("x");
		await expectArchive({
			format: fgaFormat,
			archive: buildFga(
				[{ records: [{ name: "a.dat", offset: 0, size: 1 }] }],
				[plain],
			),
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects a continuation that does not move forward", async () => {
		const plain = Buffer.from("x");
		const archive = buildFga(
			[
				{
					records: [{ name: "a.dat", offset: 0, size: 1 }, { chainTo: 0 }],
				},
			],
			[plain],
		);
		await expectArchive({
			format: fgaFormat,
			archive,
			sourcePath: "sample.fga",
			detected: false,
			entries: [],
		});
	});
});
