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

const WALKS: readonly {
	name: string;
	places: number;
	stream: string;
	walked: string;
}[] = [
	{
		name: "mixed",
		places: 8,
		stream: "fbf84142fe43fd",
		walked: "4142414241434241",
	},
	{ name: "count3", places: 5, stream: "fbff4142fe", walked: "4142414241" },
	{ name: "count4", places: 6, stream: "bbff4142fe", walked: "414241424142" },
	{ name: "count5", places: 7, stream: "3bff4142fe", walked: "41424142414241" },
	{
		name: "count6",
		places: 8,
		stream: "3bfe4142fe",
		walked: "4142414241424142",
	},
	{
		name: "count7",
		places: 9,
		stream: "3bf44142fe",
		walked: "414241424142414241",
	},
	{
		name: "count8",
		places: 10,
		stream: "3bfc4142fe",
		walked: "41424142414241424142",
	},
	{
		name: "count9",
		places: 11,
		stream: "3b804142fe",
		walked: "4142414241424142414241",
	},
	{
		name: "count10",
		places: 12,
		stream: "3bc04142fe",
		walked: "414241424142414241424142",
	},
	{
		name: "count12",
		places: 14,
		stream: "3be04142fe",
		walked: "4142414241424142414241424142",
	},
	{
		name: "count15",
		places: 17,
		stream: "3bb04142fe",
		walked: "4142414241424142414241424142414241",
	},
	{
		name: "count16",
		places: 18,
		stream: "3bf04142fe",
		walked: "414241424142414241424142414241424142",
	},
];

describe("AdvSys engine compressed image format", () => {
	it("reads the head of a picture of each of the two kinds of the walk of it", () => {
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
		expect(readPolaLayout(buildHead({ mark: "GR2_" }), 0x40)).toBeUndefined();
	});

	it("walks the places of a picture whose places of the walk all stand for themselves", () => {
		const places = Buffer.from([
			0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
		]);
		const stream = Buffer.concat([Buffer.from([0xff, 0xff]), places]);
		expect(unpackPolaPicture(stream, 8)).toEqual(
			Buffer.concat([places, Buffer.alloc(2)]),
		);
		const short = Buffer.from([0x41, 0x42, 0x43, 0x44]);
		expect(
			unpackPolaPicture(Buffer.concat([Buffer.from([0xff, 0xff]), short]), 4),
		).toEqual(Buffer.concat([short, Buffer.alloc(2)]));
	});

	it("walks the places of a picture whose places of the walk name the places behind them", () => {
		for (const walk of WALKS) {
			expect(
				unpackPolaPicture(Buffer.from(walk.stream, "hex"), walk.places),
				walk.name,
			).toEqual(
				Buffer.concat([Buffer.from(walk.walked, "hex"), Buffer.alloc(2)]),
			);
		}
	});

	it("turns a walk that stands short of the places of the picture away", () => {
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
