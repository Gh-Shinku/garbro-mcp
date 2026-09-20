import { Buffer } from "node:buffer";
import { FileByteSource } from "@garbro-mcp/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	RPGMV_SIGNATURE,
	decryptRpgmvStream,
	findRpgmvKey,
	parseRpgmvKey,
	parseRpgmvSystem,
} from "../../packages/formats/src/rpg-maker/rpgmv-core.js";
import { rpgMakerRpgmvpImageFormat } from "../../packages/formats/src/rpg-maker/rpgmvp-image.js";
import { rpgMakerRpgmvoAudioFormat } from "../../packages/formats/src/rpg-maker/rpgmvo-audio.js";

/** The key of the engine as it stands in the words of the engine of the tests. */
const KEY_HEX = "774e4645fc432f714795a243e51013d8";
const KEY = Buffer.from(KEY_HEX, "hex");

const SYSTEM_JSON = JSON.stringify({ encryptionKey: KEY_HEX });

/** Writes a game into a temporary directory and runs the callback with the place of the file of the test. */
async function withGame(
	files: Record<string, Buffer | string>,
	run: (mainPath: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(resolve(tmpdir(), "garbro-rpgmv-"));
	try {
		for (const [name, content] of Object.entries(files)) {
			const at = resolve(root, name);
			await mkdir(dirname(at), { recursive: true });
			await writeFile(at, content);
		}
		await run(resolve(root, "www/img/pictures/picture.rpgmvp"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function encryptedFile(body: Buffer, key: Buffer = KEY): Buffer {
	const head = Buffer.alloc(0x20, 0x00);
	RPGMV_SIGNATURE.copy(head, 0);
	for (let at = 0; at < 0x10; at += 1) {
		head[0x10 + at] = (body[at] ?? 0) ^ (key[at] ?? 0);
	}
	return Buffer.concat([head, body.subarray(0x10)]);
}

/** A portable network graphic of four and twenty places by four and twenty, cut short of its places. */
function png(): Buffer {
	const body = Buffer.alloc(0x30, 0x00);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(body, 0);
	body.writeUInt32BE(0x0d, 8);
	body.write("IHDR", 12, "latin1");
	body.writeUInt32BE(0x18, 16);
	body.writeUInt32BE(0x18, 20);
	body[24] = 8;
	body[25] = 6;
	return body;
}

/** A sound of the Ogg kind, cut short of its places. */
function ogg(): Buffer {
	const body = Buffer.alloc(0x30, 0x00);
	body.write("OggS", 0, "latin1");
	body[4] = 0x00;
	return body;
}

describe("RPG Maker engine formats", () => {
	it("reads the places of the key the words of the engine name", () => {
		expect(parseRpgmvKey(KEY_HEX)).toEqual(KEY);
		expect(parseRpgmvKey("00FF")).toEqual(Buffer.from([0x00, 0xff]));
		expect(parseRpgmvKey("012")).toBeUndefined();
		expect(parseRpgmvKey("zz")).toBeUndefined();
	});

	it("reads the key of the words of the engine", () => {
		expect(parseRpgmvSystem(SYSTEM_JSON)).toEqual(KEY);
		expect(parseRpgmvSystem('{"encryptionKey":123}')).toBeUndefined();
		expect(parseRpgmvSystem("{}")).toBeUndefined();
		expect(parseRpgmvSystem("not words of the engine")).toBeUndefined();
		expect(parseRpgmvSystem("[]")).toBeUndefined();
	});

	it("finds the key of the words of the engine beside the file and above it", async () => {
		await withGame(
			{
				"www/data/System.json": SYSTEM_JSON,
				"www/img/pictures/picture.rpgmvp": encryptedFile(png()),
			},
			async (mainPath) => {
				expect(await findRpgmvKey(mainPath)).toEqual(KEY);
			},
		);
		await withGame(
			{
				"data/System.json": SYSTEM_JSON,
				"www/img/pictures/picture.rpgmvp": encryptedFile(png()),
			},
			async (mainPath) => {
				expect(await findRpgmvKey(mainPath)).toEqual(KEY);
			},
		);
		await withGame(
			{ "www/img/pictures/picture.rpgmvp": encryptedFile(png()) },
			async (mainPath) => {
				expect(await findRpgmvKey(mainPath)).toBeUndefined();
			},
		);
	});

	it("stands the places of the key beside the head of the file", () => {
		const body = png();
		const stored = encryptedFile(body);
		expect(decryptRpgmvStream(stored, KEY)).toEqual(body);
	});

	it("hands out the picture the places of the key stand for", async () => {
		const body = png();
		await withGame(
			{
				"www/data/System.json": SYSTEM_JSON,
				"www/img/pictures/picture.rpgmvp": encryptedFile(body),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await rpgMakerRpgmvpImageFormat.detect(source, mainPath)).toBe(
					true,
				);
				const archive = await rpgMakerRpgmvpImageFormat.open(source, mainPath);
				try {
					expect(archive.metadata).toMatchObject({
						image: "png",
						width: 0x18,
						height: 0x18,
						bitsPerPixel: 32,
					});
					const entry = archive.entries[0];
					if (!entry) throw new Error("no entry");
					expect(entry.path).toBe("picture.png");
					expect(
						await consumeBuffer(await archive.openEntry(entry.id)),
					).toEqual(body);
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("hands out the sound the places of the key stand for", async () => {
		const body = ogg();
		await withGame(
			{
				"www/data/System.json": SYSTEM_JSON,
				"www/img/pictures/picture.rpgmvp": encryptedFile(body),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await rpgMakerRpgmvoAudioFormat.detect(source, mainPath)).toBe(
					true,
				);
				// A file whose places the key stands as a picture stands as no sound, and the other way round.
				expect(await rpgMakerRpgmvpImageFormat.detect(source, mainPath)).toBe(
					false,
				);
				const archive = await rpgMakerRpgmvoAudioFormat.open(source, mainPath);
				try {
					expect(archive.metadata).toMatchObject({ audio: "ogg" });
					const entry = archive.entries[0];
					if (!entry) throw new Error("no entry");
					expect(entry.path).toBe("picture.ogg");
					expect(
						await consumeBuffer(await archive.openEntry(entry.id)),
					).toEqual(body);
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("turns a file of the engine whose key stands nowhere away", async () => {
		await withGame(
			{ "www/img/pictures/picture.rpgmvp": encryptedFile(png()) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await rpgMakerRpgmvpImageFormat.detect(source, mainPath)).toBe(
					false,
				);
				await expect(
					rpgMakerRpgmvpImageFormat.open(source, mainPath),
				).rejects.toThrow("Not an RPG Maker picture");
			},
		);
	});

	it("turns a file of the engine whose places stand for no picture away", async () => {
		const other = Buffer.alloc(0x30, 0x22);
		await withGame(
			{
				"www/data/System.json": SYSTEM_JSON,
				"www/img/pictures/picture.rpgmvp": encryptedFile(other),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await rpgMakerRpgmvpImageFormat.detect(source, mainPath)).toBe(
					false,
				);
			},
		);
		// A file that does not stand behind the word of the engine stands as no file of the engine.
		const head = encryptedFile(png());
		head[4] = 0x58;
		await withGame(
			{
				"www/data/System.json": SYSTEM_JSON,
				"www/img/pictures/picture.rpgmvp": head,
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await rpgMakerRpgmvpImageFormat.detect(source, mainPath)).toBe(
					false,
				);
			},
		);
	});

	it("is told by the word of the engine", () => {
		expect(rpgMakerRpgmvpImageFormat.descriptor.id).toBe(
			"rpg-maker-rpgmvp-image",
		);
		expect(rpgMakerRpgmvoAudioFormat.descriptor.id).toBe(
			"rpg-maker-rpgmvo-audio",
		);
		expect(rpgMakerRpgmvpImageFormat.detection).toEqual({
			signatures: [{ bytes: RPGMV_SIGNATURE }],
		});
		expect(rpgMakerRpgmvpImageFormat.descriptor.extensions).toEqual([
			"rpgmvp",
			"png_",
		]);
		expect(rpgMakerRpgmvoAudioFormat.descriptor.extensions).toEqual([
			"rpgmvo",
			"ogg_",
		]);
	});
});
