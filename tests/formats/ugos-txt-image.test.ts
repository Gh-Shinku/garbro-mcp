import { Buffer } from "node:buffer";
import { FileByteSource } from "@garbro-mcp/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readUgoTxtLayout,
	ugoTxtFormat,
} from "../../packages/formats/src/ugos/txt-image.js";

const FIRST_TILE = Buffer.from([1, 2, 3, 4]);
const SECOND_TILE = Buffer.from([5, 6]);

const PICTURE = Buffer.from(
	"4,2,8\r\ntile@1,2.bmp\r\nother@0,0.bmp\r\n",
	"latin1",
);

async function withPicture(
	words: Buffer,
	run: (wordsPath: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(resolve(tmpdir(), "garbro-ugos-"));
	try {
		await mkdir(resolve(root, "pictures"), { recursive: true });
		await writeFile(resolve(root, "pictures/tile@1,2.bmp"), FIRST_TILE);
		await writeFile(resolve(root, "pictures/other@0,0.bmp"), SECOND_TILE);
		const wordsPath = resolve(root, "pictures/picture.txt");
		await writeFile(wordsPath, words);
		await run(wordsPath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("μ-GameOperationSystem tiled bitmap", () => {
	it("reads the words that name the places of a picture", () => {
		expect(readUgoTxtLayout(PICTURE, PICTURE.length)).toEqual({
			width: 4,
			height: 2,
			tileSize: 8,
			tiles: [
				// The places of a place of a picture stand beside the place the words name rather than behind
				// it, and they stand in places of a picture rather than in places of a tile.
				{ fileName: "tile@1,2.bmp", x: 16, y: 8 },
				{ fileName: "other@0,0.bmp", x: 0, y: 0 },
			],
		});
	});

	it("turns away words that name no picture", () => {
		for (const words of [
			"",
			"4,2\r\n",
			"4,2,0\r\n",
			"4,2,8\r\nnot a tile\r\n",
			"4,2,8\r\n",
			"0,2,8\r\n",
		]) {
			expect(
				readUgoTxtLayout(Buffer.from(words, "latin1"), words.length),
			).toBeUndefined();
		}
		const long = Buffer.alloc(0x1001, 0x20);
		expect(readUgoTxtLayout(long, long.length)).toBeUndefined();
	});

	it("hands out the places of the tiles of a picture as they stand", async () => {
		await withPicture(PICTURE, async (wordsPath) => {
			const source = await FileByteSource.open(wordsPath);
			expect(await ugoTxtFormat.detect(source, wordsPath)).toBe(true);
			const archive = await ugoTxtFormat.open(source, wordsPath);
			try {
				expect(archive.metadata).toMatchObject({
					entryCount: 2,
					width: 4,
					height: 2,
					tileSize: 8,
				});
				expect(archive.entries.map((entry) => entry.path)).toEqual([
					"tile@1,2.bmp",
					"other@0,0.bmp",
				]);
				expect(archive.entries[0]?.metadata).toMatchObject({ x: 16, y: 8 });
				const first = archive.entries[0];
				const second = archive.entries[1];
				if (!first || !second) throw new Error("no entries");
				expect(await consumeBuffer(await archive.openEntry(first.id))).toEqual(
					FIRST_TILE,
				);
				expect(await consumeBuffer(await archive.openEntry(second.id))).toEqual(
					SECOND_TILE,
				);
			} finally {
				await archive.close();
			}
		});
	});

	it("turns away a picture whose tile stands nowhere", async () => {
		await withPicture(
			Buffer.from("4,2,8\r\ngone@9,9.bmp\r\n", "latin1"),
			async (wordsPath) => {
				const source = await FileByteSource.open(wordsPath);
				const archive = await ugoTxtFormat.open(source, wordsPath);
				const entry = archive.entries[0];
				if (!entry) throw new Error("no entry");
				await expect(archive.openEntry(entry.id)).rejects.toThrow(
					"μ-GameOperationSystem picture stands without the places of a tile of its own",
				);
			},
		);
	});

	it("is told by the words of the kind of files it stands as", async () => {
		expect(ugoTxtFormat.descriptor.id).toBe("ugos-txt-image");
		expect(ugoTxtFormat.detection).toEqual({
			signatures: [],
			extensionFallback: true,
		});
		await withPicture(PICTURE, async (wordsPath) => {
			const source = await FileByteSource.open(wordsPath);
			expect(await ugoTxtFormat.detect(source, `${wordsPath}.png`)).toBe(false);
		});
	});
});
