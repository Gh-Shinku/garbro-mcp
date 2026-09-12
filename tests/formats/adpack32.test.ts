import {
	BufferByteSource,
	extractArchive,
	GarbroError,
} from "@garbro-mcp/core";
import { Adpack32Format, createDefaultRegistry } from "@garbro-mcp/formats";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixture = resolve("fixtures/adpack32/basic.pak");
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("Active Soft ADPACK32", () => {
	it("detects and lists entries with CP932 names", async () => {
		const archive = await createDefaultRegistry().openArchive(fixture);
		try {
			expect(archive.format.id).toBe("adpack32");
			expect(archive.entries).toMatchObject([
				{ id: "0", path: "hello.txt", size: 15n },
				{ id: "1", path: "画像.bin", size: 6n },
			]);
		} finally {
			await archive.close();
		}
	});

	it("extracts every entry", async () => {
		const outputDirectory = await mkdtemp(
			resolve(tmpdir(), "garbro-adpack32-test-"),
		);
		temporaryDirectories.push(outputDirectory);
		const archive = await createDefaultRegistry().openArchive(fixture);
		try {
			const result = await extractArchive(archive, { outputDirectory });
			expect(result.bytesWritten).toBe(21n);
			expect(
				await readFile(resolve(outputDirectory, "hello.txt"), "utf8"),
			).toBe("hello adpack32\n");
			expect(await readFile(resolve(outputDirectory, "画像.bin"))).toEqual(
				Buffer.from([0, 1, 2, 0xfd, 0xfe, 0xff]),
			);
		} finally {
			await archive.close();
		}
	});

	it("rejects indexes whose sentinel offset is outside the archive", async () => {
		const malformed = Buffer.alloc(0x50);
		malformed.write("ADPACK32", 0, "ascii");
		malformed.writeUInt32LE(2, 12);
		malformed.write("entry.bin", 0x10, "ascii");
		malformed.writeUInt32LE(0x50, 0x2c);
		malformed.writeUInt32LE(0x51, 0x4c);
		const format = new Adpack32Format();
		await expect(
			format.open(new BufferByteSource(malformed), "malformed.pak"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
