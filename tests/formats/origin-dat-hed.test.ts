import { FileByteSource, type ArchiveHandle } from "@garbro-mcp/core";
import { originHedDatFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

/** Opens the archive of a companion pair and runs the callback with it. */
async function withArchive<T>(
	mainPath: string,
	run: (archive: ArchiveHandle) => Promise<T>,
): Promise<T> {
	const source = await FileByteSource.open(mainPath);
	try {
		const archive = await originHedDatFormat.open(source, mainPath);
		try {
			return await run(archive);
		} finally {
			await archive.close();
		}
	} finally {
		await source.close();
	}
}

/** Asserts detection against a companion pair without listing it. */
async function expectDetection(
	mainName: string,
	files: Record<string, Buffer>,
	expected: boolean,
): Promise<void> {
	await withCompanionFiles(mainName, files, async (mainPath) => {
		const source = await FileByteSource.open(mainPath);
		try {
			expect(await originHedDatFormat.detect(source, mainPath)).toBe(expected);
		} finally {
			await source.close();
		}
	});
}

/** Builds a `.hed` entry: an optional masked name field and the payload offset. */
function hedEntry(name: string | undefined, offset: number): Buffer {
	if (name === undefined) {
		const generated = Buffer.alloc(5);
		generated.writeUInt8(0, 0);
		generated.writeUInt32LE(offset, 1);
		return generated;
	}
	const field = Buffer.concat([Buffer.from(name, "latin1"), Buffer.from([0])]);
	const masked = Buffer.from(field.map((value) => value ^ 0xff));
	const head = Buffer.alloc(1);
	head.writeUInt8(masked.length, 0);
	const tail = Buffer.alloc(4);
	tail.writeUInt32LE(offset, 0);
	return Buffer.concat([head, masked, tail]);
}

/** A payload that looks like an image: an alpha flag, a method byte, width and height. */
function imagePayload(method: number, width: number, height: number): Buffer {
	const data = Buffer.alloc(0x20);
	data.writeUInt8(0, 0);
	data.writeUInt8(method, 1);
	data.writeUInt16LE(width, 2);
	data.writeUInt16LE(height, 4);
	return data;
}

describe("origin dat hed", () => {
	it("lists entries from the sibling index", async () => {
		const payloads = [
			imagePayload(2, 0x40, 0x30),
			Buffer.from("second payload, plain data here"),
			Buffer.from("third"),
		];
		const offsets: number[] = [];
		let position = 0;
		for (const payload of payloads) {
			offsets.push(position);
			position += payload.length;
		}
		const index = Buffer.concat([
			hedEntry("FIRST.BMP", offsets[0] ?? 0),
			hedEntry("SECOND.TXT", offsets[1] ?? 0),
			hedEntry("THIRD.BIN", offsets[2] ?? 0),
		]);
		await withCompanionFiles(
			"GAME.DAT",
			{ "GAME.HED": index, "GAME.DAT": Buffer.concat(payloads) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: originHedDatFormat,
					mainPath,
					entries: payloads.map((payload, index_) => ({
						path: ["FIRST.BMP", "SECOND.TXT", "THIRD.BIN"][index_] ?? "",
						size: payload.length,
						content: payload,
					})),
					metadata: { entryCount: 3 },
				});
			},
		);
	});

	it("generates a name for an empty name field", async () => {
		const payload = Buffer.from("unnamed payload");
		await withCompanionFiles(
			"GAME.DAT",
			{ "GAME.HED": hedEntry(undefined, 0), "GAME.DAT": payload },
			async (mainPath) => {
				await expectCompanionArchive({
					format: originHedDatFormat,
					mainPath,
					entries: [
						{ path: "GAME#0000", size: payload.length, content: payload },
					],
				});
			},
		);
	});

	it("marks image payloads and reads their header", async () => {
		const payload = imagePayload(3, 0x1234, 0x567);
		await withCompanionFiles(
			"GAME.DAT",
			{ "GAME.HED": hedEntry("PIC.BMP", 0), "GAME.DAT": payload },
			async (mainPath) => {
				const metadata = await withArchive(mainPath, async (archive) =>
					archive.entries.map((entry) => entry.metadata),
				);
				expect(metadata[0]).toMatchObject({
					type: "image",
					hasAlpha: false,
					method: 3,
					width: 0x1234,
					height: 0x567,
					bpp: 32,
				});
			},
		);
	});

	it("shifts an audio entry behind its prefix", async () => {
		const stream = Buffer.concat([
			Buffer.alloc(0xd),
			Buffer.from("OggS"),
			Buffer.alloc(0x30, 0x41),
		]);
		await withCompanionFiles(
			"GAME.DAT",
			{ "GAME.HED": hedEntry("VOICE.DAT", 0), "GAME.DAT": stream },
			async (mainPath) => {
				await withArchive(mainPath, async (archive) => {
					const entry = archive.entries[0];
					if (!entry) throw new Error("missing entry");
					expect(Number(entry.size)).toBe(stream.length - 0xd);
					expect(entry.metadata).toMatchObject({ type: "audio" });
					const output = await consumeBuffer(await archive.openEntry(entry.id));
					expect(output.subarray(0, 4).toString("latin1")).toBe("OggS");
				});
			},
		);
	});

	it("reads a mask archive with eight byte image headers", async () => {
		const payload = Buffer.alloc(0x20);
		payload.writeUInt32LE(0x20, 0);
		payload.writeUInt32LE(0x10, 4);
		await withCompanionFiles(
			"MASK.DAT",
			{ "MASK.HED": hedEntry("MASK", 0), "MASK.DAT": payload },
			async (mainPath) => {
				const metadata = await withArchive(mainPath, async (archive) =>
					archive.entries.map((entry) => entry.metadata),
				);
				expect(metadata[0]).toMatchObject({
					type: "image",
					width: 0x20,
					height: 0x10,
					bpp: 8,
					isMask: true,
				});
			},
		);
	});

	it("declines a file without a sibling index", async () => {
		await expectDetection(
			"GAME.DAT",
			{ "GAME.DAT": Buffer.from("payload without index") },
			false,
		);
	});

	it("declines an entry offset behind the end of the data file", async () => {
		await expectDetection(
			"GAME.DAT",
			{
				"GAME.HED": hedEntry("BROKEN.BIN", 0x1000),
				"GAME.DAT": Buffer.from("short"),
			},
			false,
		);
	});

	it("declines a file whose extension is not dat", async () => {
		await expectDetection(
			"GAME.DATA",
			{ "GAME.HED": hedEntry("A.BIN", 0), "GAME.DATA": Buffer.from("payload") },
			false,
		);
	});
});
