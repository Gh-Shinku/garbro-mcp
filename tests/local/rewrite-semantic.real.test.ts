import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { WorkspacePolicy } from "@garbro-mcp/core";
import { siglusEngineAdapter } from "@garbro-mcp/semantic";
import { describe, expect, it } from "vitest";

const gameRoot = "C:/Users/shinku/Game/Galgame/Rewrite";

async function sha256(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

describe.skipIf(!existsSync(resolve(gameRoot, "Scene.pck")))(
	"Rewrite semantic probe",
	() => {
		it("identifies Siglus without changing its evidence files", async () => {
			const output = await mkdtemp(
				resolve(tmpdir(), "garbro-rewrite-semantic-"),
			);
			try {
				const scene = resolve(gameRoot, "Scene.pck");
				const gameexe = resolve(gameRoot, "Gameexe.dat");
				const before = {
					scene: await sha256(scene),
					gameexe: await sha256(gameexe),
				};
				const workspace = new WorkspacePolicy({
					inputRoots: { rewrite: gameRoot },
					outputRoot: output,
				});
				const result = await siglusEngineAdapter.probe({
					workspace,
					game: { rootId: "rewrite", path: "." },
					allowExecutableInspection: false,
					maxInputBytes: 64n * 1024n * 1024n,
					signal: new AbortController().signal,
				});
				expect(result).toMatchObject({
					status: "matched",
					confidence: "high",
					profile: "scene-header-92",
					fingerprint: {
						value: expect.stringMatching(/^[0-9a-f]{64}$/),
						files: expect.any(Array),
					},
				});
				expect(await sha256(scene)).toBe(before.scene);
				expect(await sha256(gameexe)).toBe(before.gameexe);
			} finally {
				await rm(output, { recursive: true, force: true });
			}
		}, 120_000);
	},
);
