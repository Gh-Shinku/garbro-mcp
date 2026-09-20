import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decryptSec5Code,
	readSec5Sections,
	sas5Sec5Format,
} from "../../packages/formats/src/sas5/sec5.js";

const FIRST_SECTION = 8;

function head(): Buffer {
	const out = Buffer.alloc(FIRST_SECTION, 0x00);
	out.write("SEC5", 0, "latin1");
	return out;
}

function section(name: string, data: Buffer): Buffer {
	const out = Buffer.alloc(8 + data.length, 0x00);
	out.write(name, 0, "latin1");
	out.writeUInt32LE(data.length, 4);
	data.copy(out, 8);
	return out;
}

describe("SAS5 engine resource index file", () => {
	it("reads the places of the picture of the walk of the places of the picture of the places of the engine", () => {
		const file = Buffer.concat([
			head(),
			section("CODE", Buffer.from([0x10, 0x20, 0x30])),
			section("RESR", Buffer.from([0xaa, 0xbb])),
			Buffer.from("ENDS", "latin1"),
		]);
		const sections = readSec5Sections(file, file.length);
		expect(sections).toEqual([
			{
				name: "CODE",
				offset: FIRST_SECTION + 8,
				size: 3,
				encrypted: true,
			},
			{
				name: "RESR",
				offset: FIRST_SECTION + 8 + 3 + 8,
				size: 2,
				encrypted: false,
			},
		]);
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them where the places of the picture of the walk of the places of the picture of the engine stand not", () => {
		const file = Buffer.concat([
			head(),
			section("RES2", Buffer.from([0x01, 0x02, 0x03, 0x04])),
		]);
		const sections = readSec5Sections(file, file.length);
		expect(sections?.length).toBe(1);
		expect(sections?.[0]?.name).toBe("RES2");
		expect(sections?.[0]?.size).toBe(4);
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the engine of the words of the walk of the picture of their own", () => {
		expect(decryptSec5Code(Buffer.from([0x10, 0x20, 0x30]))).toEqual(
			Buffer.from([0x10, 0x02, 0x64]),
		);
		expect(decryptSec5Code(Buffer.from([0xf0, 0x00]))).toEqual(
			Buffer.from([0xf0, 0x02]),
		);
		expect(decryptSec5Code(Buffer.alloc(0)).length).toBe(0);
	});

	it("turns away the places of the picture of the walk of the places of the picture of the places of the picture of no places of the picture of the walk of them", () => {
		const good = Buffer.concat([
			head(),
			section("CODE", Buffer.from([0x10])),
			Buffer.from("ENDS", "latin1"),
		]);
		const wrongMark = Buffer.from(good);
		wrongMark.write("SEC6", 0, "latin1");
		expect(readSec5Sections(wrongMark, wrongMark.length)).toBeUndefined();
		const short = Buffer.alloc(4, 0x00);
		short.write("SEC5", 0, "latin1");
		expect(readSec5Sections(short, short.length)).toBeUndefined();
		const noSections = Buffer.concat([head(), Buffer.from("ENDS", "latin1")]);
		expect(readSec5Sections(noSections, noSections.length)).toBeUndefined();
		const past = Buffer.concat([head(), section("CODE", Buffer.alloc(4))]);
		past.writeUInt32LE(0x1000, FIRST_SECTION + 4);
		expect(() => readSec5Sections(past, past.length)).toThrow(GarbroError);
		const cutHead = Buffer.concat([head(), Buffer.from("COD", "latin1")]);
		expect(() => readSec5Sections(cutHead, cutHead.length)).toThrow(
			GarbroError,
		);
	});

	it("stands the places of the picture of the walk of the places of the picture of the places of the picture of the engine out", async () => {
		const file = Buffer.concat([
			head(),
			section("CODE", Buffer.from([0x10, 0x20, 0x30])),
			section("RESR", Buffer.from([0xaa, 0xbb])),
			Buffer.from("ENDS", "latin1"),
		]);
		const handle = await sas5Sec5Format.open(
			new BufferByteSource(file),
			"system/adv.sec5",
		);
		expect(handle.entries.map((entry) => entry.path)).toEqual(["CODE", "RESR"]);
		const code = handle.entries[0];
		const resr = handle.entries[1];
		if (!code || !resr) throw new Error("no entries");
		expect(await consumeBuffer(await handle.openEntry(code.id))).toEqual(
			Buffer.from([0x10, 0x02, 0x64]),
		);
		expect(await consumeBuffer(await handle.openEntry(resr.id))).toEqual(
			Buffer.from([0xaa, 0xbb]),
		);
	});

	it("is told by the words of the picture of the walk of the places of the picture of the places of the engine", async () => {
		expect(sas5Sec5Format.descriptor.id).toBe("sas5-sec5");
		const file = Buffer.concat([
			head(),
			section("RESR", Buffer.alloc(2)),
			Buffer.from("ENDS", "latin1"),
		]);
		await expect(
			sas5Sec5Format.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("SEC6", 0, "latin1");
		await expect(
			sas5Sec5Format.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
		await expect(
			sas5Sec5Format.detect(new BufferByteSource(Buffer.alloc(4))),
		).resolves.toBe(false);
	});

	it("turns a picture of the places of the picture of no places of the walk of them away", async () => {
		await expect(
			sas5Sec5Format.open(new BufferByteSource(Buffer.alloc(8)), "x.sec5"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
