import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	cottonClubLmgImageFormat,
	readLmgLayout,
	unpackLmg,
} from "../../packages/formats/src/cotton-club/lmg-image.js";

const NAME = "pic.lmg";

/** The key the reference takes from the file's own name, in lower case. */
function nameKey(name: string): number {
	let key = 0;
	for (let index = 0; index < name.length; index += 1) {
		key ^= name.toLowerCase().charCodeAt(index) & 0xff;
	}
	return key;
}

/** The stream scrambled the way the reference unscrambles it. */
function scramble(plain: Buffer, name = NAME): Buffer {
	const out = Buffer.alloc(plain.length, 0x00);
	let key = nameKey(name);
	for (let index = 0; index < plain.length; index += 1) {
		const value = plain[index] ?? 0;
		const scrambled = value ^ key;
		out[index] = scrambled;
		key = scrambled;
	}
	return out;
}

/** A picture: the head and the scrambled stream. */
function lmgFile(input: {
	width: number;
	height: number;
	method: number;
	plain: Buffer;
}): Buffer {
	const head = Buffer.alloc(12, 0x00);
	Buffer.from("LMG", "latin1").copy(head, 0);
	head.writeUInt8(input.method, 3);
	head.writeUInt32LE(input.width, 4);
	head.writeUInt32LE(input.height, 8);
	return Buffer.concat([head, scramble(input.plain)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await cottonClubLmgImageFormat.open(
		new BufferByteSource(data),
		NAME,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Cotton Club encrypted image", () => {
	it("reads the head as the reference does", () => {
		const data = lmgFile({
			width: 2,
			height: 1,
			method: 1,
			plain: Buffer.alloc(6),
		});
		expect(readLmgLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			method: 1,
			dataLength: 6,
		});
		// The run walk of method two is thirty two bits a pixel.
		const runs = lmgFile({
			width: 2,
			height: 2,
			method: 2,
			plain: Buffer.from([0xff, 0x04, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
		});
		expect(readLmgLayout(runs)).toMatchObject({ bitsPerPixel: 32, method: 2 });
	});

	it("gates on the mark, the method, the measurements and the stream", () => {
		const good = lmgFile({
			width: 2,
			height: 1,
			method: 1,
			plain: Buffer.alloc(6),
		});
		expect(readLmgLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("LNG", 0, "latin1");
		expect(readLmgLayout(mark)).toBeUndefined();
		const method = Buffer.from(good);
		method.writeUInt8(4, 3);
		expect(readLmgLayout(method)).toBeUndefined();
		const none = Buffer.from(good);
		none.writeUInt32LE(0, 4);
		expect(readLmgLayout(none)).toBeUndefined();
		// Method one needs a byte for every byte of the picture.
		const short = Buffer.concat([good.subarray(0, 12), Buffer.alloc(2)]);
		expect(readLmgLayout(short)).toBeUndefined();
	});

	it("unfolds a run of opaque pixels", () => {
		const layout = {
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			method: 2,
			dataLength: 14,
		};
		const plain = Buffer.from([
			0xff, 0x04, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99,
			0xaa, 0xbb, 0xcc,
		]);
		expect(unpackLmg(plain, layout).toString("hex")).toBe(
			"112233ff445566ff778899ffaabbccff",
		);
	});

	it("leaves the pixels that stand as they are", () => {
		const layout = {
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			method: 2,
			dataLength: 3,
		};
		expect(
			unpackLmg(Buffer.from([0x00, 0x02, 0x00]), layout).toString("hex"),
		).toBe("0000000000000000");
	});

	it("takes the fourth byte of a pixel from the stream", () => {
		const layout = {
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			method: 2,
			dataLength: 9,
		};
		const plain = Buffer.from([
			0x80, 0x02, 0x11, 0x22, 0x33, 0x77, 0x44, 0x55, 0x66,
		]);
		expect(unpackLmg(plain, layout).toString("hex")).toBe("1122338044556677");
	});

	it("writes a picture of pixels that stand out again", async () => {
		const out = await extract(
			lmgFile({
				width: 2,
				height: 1,
				method: 1,
				plain: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1122334455660000");
	});

	it("writes a picture of runs out again", async () => {
		const out = await extract(
			lmgFile({
				width: 2,
				height: 2,
				method: 2,
				plain: Buffer.from([
					0xff, 0x04, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
					0x99, 0xaa, 0xbb, 0xcc,
				]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"112233ff445566ff778899ffaabbccff",
		);
	});

	it("refuses a picture behind a JPEG", async () => {
		const data = lmgFile({
			width: 2,
			height: 1,
			method: 3,
			plain: Buffer.alloc(6),
		});
		const handle = await cottonClubLmgImageFormat.open(
			new BufferByteSource(data),
			NAME,
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow(
			"behind a JPEG is not supported",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = lmgFile({
			width: 2,
			height: 1,
			method: 1,
			plain: Buffer.alloc(6),
		});
		data.write("LNG", 0, "latin1");
		await expect(
			cottonClubLmgImageFormat.open(new BufferByteSource(data), NAME),
		).rejects.toThrow("Not a Cotton Club picture");
	});
});
