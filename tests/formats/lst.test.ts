import { encodeCp932 } from "@garbro-mcp/core";
import { createDefaultRegistry } from "@garbro-mcp/formats";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function encodeName(name: string, size: number, key: number): Buffer {
	const output = Buffer.alloc(size);
	const encoded = encodeCp932(name);
	for (let index = 0; index < encoded.length && index < size; index += 1) {
		output[index] = (encoded[index] ?? 0) ^ key;
	}
	return output;
}

function buildMoon(): { data: Buffer; list: Buffer; outputs: Buffer[] } {
	const definitions = [
		{ name: "script.snx", output: Buffer.from("moon script") },
		{ name: "画像.tgf", output: Buffer.from("moon image") },
	];
	const data = Buffer.concat(definitions.map(({ output }) => output));
	const list = Buffer.alloc(4 + definitions.length * 0x2c);
	list.writeUInt32LE((definitions.length ^ 0xcccccccc) >>> 0, 0);
	let offset = 0;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 4 + index * 0x2c;
		list.writeUInt32LE((offset ^ 0xcccccccc) >>> 0, recordOffset);
		list.writeUInt32LE(
			(definition.output.length ^ 0xcccccccc) >>> 0,
			recordOffset + 4,
		);
		encodeName(definition.name, 0x24, 0xcc).copy(list, recordOffset + 8);
		offset += definition.output.length;
	}
	return { data, list, outputs: definitions.map(({ output }) => output) };
}

function buildNexton(): { data: Buffer; list: Buffer; outputs: Buffer[] } {
	const key = 0x55;
	const scriptOutput = Buffer.from("decoded nexton script");
	const scriptStored = Buffer.alloc(scriptOutput.length);
	for (let index = 0; index < scriptOutput.length; index += 1) {
		scriptStored[index] = (scriptOutput[index] ?? 0) ^ ((key + 1) & 0xff);
	}
	const definitions = [
		{ name: "SCENE.DAT", type: 1, stored: scriptStored, output: scriptOutput },
		{
			name: "GRAPHIC.DAT",
			type: 3,
			stored: Buffer.from("PNG synthetic"),
			output: Buffer.from("PNG synthetic"),
		},
	];
	const data = Buffer.concat(definitions.map(({ stored }) => stored));
	const list = Buffer.alloc(4 + definitions.length * 0x4c);
	const keyWord = (key | (key << 8) | (key << 16) | (key << 24)) >>> 0;
	list.writeUInt32LE((definitions.length ^ keyWord) >>> 0, 0);
	let offset = 0;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 4 + index * 0x4c;
		list.writeUInt32LE((offset ^ keyWord) >>> 0, recordOffset);
		list.writeUInt32LE(
			(definition.stored.length ^ keyWord) >>> 0,
			recordOffset + 4,
		);
		encodeName(definition.name, 0x40, key).copy(list, recordOffset + 8);
		list.writeInt32LE(definition.type, recordOffset + 0x48);
		offset += definition.stored.length;
	}
	return { data, list, outputs: definitions.map(({ output }) => output) };
}

async function writeFixture(data: Buffer, list: Buffer): Promise<string> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-lst-test-"));
	temporaryDirectories.push(directory);
	const dataPath = resolve(directory, "resource");
	await Promise.all([
		writeFile(dataPath, data),
		writeFile(`${dataPath}.lst`, list),
	]);
	return dataPath;
}

describe("Nexton LikeC LST", () => {
	it("opens a Moon companion index through the default registry", async () => {
		const fixture = buildMoon();
		const archive = await createDefaultRegistry().openArchive(
			await writeFixture(fixture.data, fixture.list),
		);
		try {
			expect(archive.format.id).toBe("nexton-lst");
			expect(archive.metadata).toMatchObject({ variant: "moon" });
			expect(archive.entries).toMatchObject([
				{ path: "script.snx", encrypted: false },
				{ path: "画像.tgf", encrypted: false },
			]);
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					fixture.outputs[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("maps Nexton types and decodes SNX script bytes", async () => {
		const fixture = buildNexton();
		const archive = await createDefaultRegistry().openArchive(
			await writeFixture(fixture.data, fixture.list),
		);
		try {
			expect(archive.metadata).toMatchObject({ variant: "nexton" });
			expect(archive.entries).toMatchObject([
				{ path: "SCENE.SNX", encrypted: true },
				{ path: "GRAPHIC.PNG", encrypted: false },
			]);
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					fixture.outputs[index],
				);
			}
		} finally {
			await archive.close();
		}
	});
});
