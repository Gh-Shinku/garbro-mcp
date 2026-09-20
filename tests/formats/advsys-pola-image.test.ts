import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	advsysPolaImageFormat,
	readPolaLayout,
} from "../../packages/formats/src/advsys/pola-image.js";
import { unpackPolaPicture } from "../../packages/formats/src/advsys/pola-reader.js";

const HEAD_SIZE = 0x14;
const OLD_HEAD_SIZE = 0xd;

/** A head of a picture of this kind: the words of the kind of the picture, the kind of the walk of the places
 * of it, and how many places the walk of it stands for. */
function buildHead(options?: {
	newVersion?: boolean;
	unpackedSize?: number;
	mark?: string;
}): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write(options?.mark ?? "*Pola", 0, "latin1");
	if (options?.newVersion ?? true) head.write("*  ", 5, "latin1");
	head.writeInt32LE(options?.unpackedSize ?? 0x40, 8);
	return head;
}

describe("AdvSys engine compressed image format", () => {
	it("reads the head of a picture of each of the two kinds of the walk of it", () => {
		// The places of the head of a picture of the second kind of the walk of it stand behind the words of
		// the kind of the walk of a picture, and the places of the pictures of the two kinds stand apart.
		expect(readPolaLayout(buildHead({ newVersion: true }), 0x40)).toEqual({
			dataOffset: HEAD_SIZE,
			unpackedSize: 0x40,
			newVersion: true,
		});
		expect(readPolaLayout(buildHead({ newVersion: false }), 0x40)).toEqual({
			dataOffset: OLD_HEAD_SIZE,
			unpackedSize: 0x40,
			newVersion: false,
		});
	});

	it("turns away a head that names no picture of this kind", () => {
		expect(readPolaLayout(buildHead({ mark: "*Polb" }), 0x40)).toBeUndefined();
		expect(readPolaLayout(Buffer.alloc(8), 8)).toBeUndefined();
		// The words of the kind of the picture stand in the places of the kind of the picture of the engine.
		expect(readPolaLayout(buildHead({ mark: "GR2_" }), 0x40)).toBeUndefined();
	});

	it("walks the places of a picture whose places of the walk all stand for themselves", () => {
		// A word of the walk of a picture whose places of the walk all stand for themselves stands before the
		// places of the picture it stands for, and the places of the picture stand behind it.
		const places = Buffer.from([
			0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
		]);
		const stream = Buffer.concat([Buffer.from([0xff, 0xff]), places]);
		// The places of the picture stand two places short of the places of the walk of it.
		expect(unpackPolaPicture(stream, 8)).toEqual(
			Buffer.concat([places, Buffer.alloc(2)]),
		);
	});

	it("walks a picture of four places the same way", () => {
		const places = Buffer.from([0x41, 0x42, 0x43, 0x44]);
		const stream = Buffer.concat([Buffer.from([0xff, 0xff]), places]);
		expect(unpackPolaPicture(stream, 4)).toEqual(
			Buffer.concat([places, Buffer.alloc(2)]),
		);
	});

	it("turns a walk that stands short of the places of the picture away", () => {
		// A walk that names places of the picture it stands for and stands short of them stands away.
		const short = Buffer.from([0xff, 0xff, 0x41, 0x42]);
		expect(() => unpackPolaPicture(short, 64)).toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(advsysPolaImageFormat.descriptor.id).toBe("advsys-pola-image");
		await expect(
			advsysPolaImageFormat.detect(new BufferByteSource(buildHead())),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(buildHead());
		wrongMark.write("*Polb", 0, "latin1");
		await expect(
			advsysPolaImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
