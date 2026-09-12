import { GarbroError, entryToWire, extractArchive } from "@garbro-mcp/core";
import { createDefaultRegistry, Xp3Format } from "@garbro-mcp/formats";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixtureDirectory = resolve("fixtures/xp3");
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function assertGoldenFixture(
	name: "basic.xp3" | "continued.xp3",
): Promise<void> {
	const manifest = JSON.parse(
		await readFile(resolve(fixtureDirectory, "manifest.json"), "utf8"),
	);
	const expected = manifest.archives[name] as Array<{
		id: string;
		path: string;
		size: string;
		sha256: string;
	}>;
	const registry = createDefaultRegistry();
	const archive = await registry.openArchive(resolve(fixtureDirectory, name));
	const outputDirectory = await mkdtemp(resolve(tmpdir(), "garbro-xp3-test-"));
	temporaryDirectories.push(outputDirectory);
	try {
		expect(archive.format.id).toBe("xp3");
		expect(
			archive.entries.map((entry) => ({
				id: entry.id,
				path: entry.path,
				size: entry.size.toString(),
			})),
		).toEqual(expected.map(({ id, path, size }) => ({ id, path, size })));
		const result = await extractArchive(archive, { outputDirectory });
		for (const extracted of result.files) {
			const golden = expected.find((entry) => entry.id === extracted.entry.id);
			expect(golden).toBeDefined();
			const digest = createHash("sha256")
				.update(await readFile(extracted.outputPath))
				.digest("hex");
			expect(digest).toBe(golden?.sha256);
			expect(extracted.sha256).toBe(golden?.sha256);
		}
	} finally {
		await archive.close();
	}
}

describe("XP3 format", () => {
	it("detects, lists, and extracts raw/zlib multi-segment entries", async () => {
		await assertGoldenFixture("basic.xp3");
	});

	it("follows continued raw and compressed index blocks", async () => {
		await assertGoldenFixture("continued.xp3");
	});

	it("lists protected entries but rejects extraction", async () => {
		const archive = await createDefaultRegistry().openArchive(
			resolve(fixtureDirectory, "protected.xp3"),
		);
		try {
			expect(
				entryToWire(
					archive.entries[0] as NonNullable<(typeof archive.entries)[0]>,
				),
			).toMatchObject({
				encrypted: true,
			});
			await expect(archive.openEntry("0")).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		} finally {
			await archive.close();
		}
	});

	it("does not detect arbitrary data or executable-embedded XP3", async () => {
		const { BufferByteSource } = await import("@garbro-mcp/core");
		const source = new BufferByteSource(Buffer.from("not an archive"));
		expect(await new Xp3Format().detect(source)).toBe(false);
	});

	it("uses structured format errors", () => {
		expect(new GarbroError("INVALID_ARCHIVE", "bad")).toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
