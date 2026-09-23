import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { WorkspacePolicy } from "@garbro-mcp/core";
import { siglusEngineAdapter } from "@garbro-mcp/semantic";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function sceneFixture(): Buffer {
	const offsets = [92, 100, 108, 110, 118, 126, 128, 136, 138, 146];
	const output = Buffer.alloc(147);
	output.writeUInt32LE(92, 0);
	for (let index = 0; index < offsets.length; index += 1) {
		output.writeUInt32LE(offsets[index] ?? 0, 4 + index * 8);
		output.writeUInt32LE(1, 8 + index * 8);
	}
	output[146] = 1;
	return output;
}

async function probeFixture(scene = sceneFixture(), gameexeValid = true) {
	const input = await mkdtemp(resolve(tmpdir(), "garbro-siglus-probe-"));
	const output = await mkdtemp(resolve(tmpdir(), "garbro-siglus-output-"));
	temporaryDirectories.push(input, output);
	await writeFile(resolve(input, "Scene.pck"), scene);
	const gameexe = Buffer.alloc(16);
	if (gameexeValid) gameexe.writeUInt32LE(1, 4);
	await writeFile(resolve(input, "Gameexe.dat"), gameexe);
	const workspace = new WorkspacePolicy({
		inputRoots: { games: input },
		outputRoot: output,
	});
	return siglusEngineAdapter.probe({
		workspace,
		game: { rootId: "games", path: "." },
		allowExecutableInspection: false,
		maxInputBytes: 1024n * 1024n,
		signal: new AbortController().signal,
	});
}

describe("Siglus semantic engine probe", () => {
	it("returns a high-confidence structural match and deterministic fingerprint", async () => {
		const result = await probeFixture();
		expect(result).toMatchObject({
			engineId: "siglus",
			status: "matched",
			confidence: "high",
			profile: "scene-header-92",
			fingerprint: {
				algorithm: "sha256",
				value: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
			capabilities: [
				{ predicate: "vn:spokenBy", available: false },
				{ predicate: "vn:voiceResource", available: false },
			],
		});
	});

	it("does not promote matching filenames with an invalid layout", async () => {
		const broken = sceneFixture();
		broken.writeUInt32LE(0xffffffff, 4 + 4 * 8);
		const result = await probeFixture(broken);
		expect(result).toMatchObject({ status: "candidate", confidence: "low" });
		expect(result).not.toHaveProperty("fingerprint");
	});

	it("matches a valid Scene package without Gameexe corroboration at medium confidence", async () => {
		const result = await probeFixture(sceneFixture(), false);
		expect(result).toMatchObject({ status: "matched", confidence: "medium" });
		expect(result.fingerprint?.files).toHaveLength(1);
		expect(result.fingerprint?.files[0]?.sha256).toBe(
			createHash("sha256").update(sceneFixture()).digest("hex"),
		);
	});

	it("omits fingerprinting when the remaining input budget is too small", async () => {
		const input = await mkdtemp(resolve(tmpdir(), "garbro-siglus-budget-"));
		const output = await mkdtemp(resolve(tmpdir(), "garbro-siglus-output-"));
		temporaryDirectories.push(input, output);
		await writeFile(resolve(input, "Scene.pck"), sceneFixture());
		const workspace = new WorkspacePolicy({
			inputRoots: { games: input },
			outputRoot: output,
		});
		const result = await siglusEngineAdapter.probe({
			workspace,
			game: { rootId: "games", path: "." },
			allowExecutableInspection: false,
			maxInputBytes: 100n,
			signal: new AbortController().signal,
		});
		expect(result.status).toBe("matched");
		expect(result).not.toHaveProperty("fingerprint");
		expect(result.warnings).toContain(
			"The input budget was too small to compute a full game fingerprint.",
		);
	});
});
