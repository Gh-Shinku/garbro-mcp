import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { GarbroError } from "@garbro-mcp/core";
import type {
	EngineAdapter,
	EngineProbeContext,
	EngineProbeEvidence,
	EngineProbeResult,
	GameFingerprint,
} from "../engine.js";

const SCENE_HEADER_SIZE = 0x5c;
const SECTION_PAIRS = 10;
const FIXED_WIDTH_SECTIONS = [0, 1, 3, 4, 6, 8] as const;
const MAX_TABLE_RECORDS = 10_000_000;
const GAMEEXE_PREFIX_SIZE = 8;

interface CandidateFile {
	name: string;
	absolutePath: string;
	size: bigint;
}

function childPath(basePath: string, name: string): string {
	return basePath === "." ? name : `${basePath}/${name}`;
}

async function readPrefix(
	file: CandidateFile,
	length: number,
	context: EngineProbeContext,
	consume: (bytes: number) => void,
): Promise<Buffer> {
	if (context.signal.aborted)
		throw new GarbroError("CANCELLED", "Engine probing cancelled");
	const actualLength = Number(
		file.size < BigInt(length) ? file.size : BigInt(length),
	);
	consume(actualLength);
	const handle = await open(file.absolutePath, "r");
	try {
		const output = Buffer.alloc(actualLength);
		const { bytesRead } = await handle.read(output, 0, actualLength, 0);
		return output.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

function validSceneHeader(header: Buffer, fileSize: bigint): boolean {
	if (header.length < SCENE_HEADER_SIZE) return false;
	if (header.readUInt32LE(0) !== SCENE_HEADER_SIZE) return false;
	const offsets: number[] = [];
	const counts: number[] = [];
	for (let index = 0; index < SECTION_PAIRS; index += 1) {
		const offset = header.readUInt32LE(4 + index * 8);
		const count = header.readUInt32LE(8 + index * 8);
		if (
			offset < SCENE_HEADER_SIZE ||
			BigInt(offset) >= fileSize ||
			count > MAX_TABLE_RECORDS ||
			(index > 0 && offset < (offsets[index - 1] ?? 0))
		)
			return false;
		offsets.push(offset);
		counts.push(count);
	}
	for (const index of FIXED_WIDTH_SECTIONS) {
		const nextOffset = offsets[index + 1];
		if (
			nextOffset === undefined ||
			nextOffset - (offsets[index] ?? 0) !== (counts[index] ?? 0) * 8
		)
			return false;
	}
	if (
		counts[0] !== counts[1] ||
		counts[1] !== counts[2] ||
		counts[3] !== counts[4] ||
		counts[4] !== counts[5] ||
		counts[6] !== counts[7] ||
		counts[7] !== counts[8] ||
		counts[8] !== counts[9]
	)
		return false;
	return counts[9] !== 0 && BigInt(offsets[9] ?? 0) < fileSize;
}

function validGameexePrefix(prefix: Buffer): boolean {
	return (
		prefix.length >= GAMEEXE_PREFIX_SIZE &&
		prefix.readUInt32LE(0) === 0 &&
		prefix.readUInt32LE(4) === 1
	);
}

async function validPortableExecutable(
	file: CandidateFile,
	context: EngineProbeContext,
	consume: (bytes: number) => void,
): Promise<boolean> {
	const dos = await readPrefix(file, 0x100, context, consume);
	if (dos.length < 0x40 || dos.subarray(0, 2).toString("ascii") !== "MZ")
		return false;
	const peOffset = dos.readUInt32LE(0x3c);
	if (peOffset > 1024 * 1024 || BigInt(peOffset + 6) > file.size) return false;
	const handle = await open(file.absolutePath, "r");
	try {
		consume(6);
		const signature = Buffer.alloc(6);
		const { bytesRead } = await handle.read(signature, 0, 6, peOffset);
		return (
			bytesRead === 6 &&
			signature.subarray(0, 4).equals(Buffer.from("PE\0\0", "binary"))
		);
	} finally {
		await handle.close();
	}
}

async function hashFile(
	file: CandidateFile,
	signal: AbortSignal,
): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file.absolutePath)) {
		if (signal.aborted)
			throw new GarbroError("CANCELLED", "Engine fingerprinting cancelled");
		hash.update(chunk);
	}
	return hash.digest("hex");
}

async function fingerprint(
	files: readonly CandidateFile[],
	gamePath: string,
	signal: AbortSignal,
): Promise<GameFingerprint> {
	const entries = [];
	for (const file of [...files].sort((left, right) =>
		left.name.localeCompare(right.name),
	))
		entries.push({
			path: childPath(gamePath, file.name),
			size: file.size,
			sha256: await hashFile(file, signal),
		});
	const manifest = entries
		.map((entry) => `${entry.path}\0${entry.size}\0${entry.sha256}`)
		.join("\n");
	return {
		algorithm: "sha256",
		value: createHash("sha256").update(manifest).digest("hex"),
		files: entries,
	};
}

async function candidates(context: EngineProbeContext): Promise<{
	scene?: CandidateFile;
	gameexe?: CandidateFile;
	executable?: CandidateFile;
	namesMatched: boolean;
}> {
	const game = await context.workspace.resolveInput(context.game, "directory");
	const entries = await readdir(game.absolutePath, { withFileTypes: true });
	const files: CandidateFile[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const absolutePath = resolve(game.absolutePath, entry.name);
		const info = await lstat(absolutePath);
		if (info.isSymbolicLink() || !info.isFile()) continue;
		files.push({ name: entry.name, absolutePath, size: BigInt(info.size) });
	}
	const ordered = (pattern: RegExp, preferred: string) =>
		files
			.filter((file) => pattern.test(file.name))
			.sort(
				(left, right) =>
					Number(right.name.toLowerCase() === preferred) -
						Number(left.name.toLowerCase() === preferred) ||
					left.name.localeCompare(right.name),
			)[0];
	const scene = ordered(/^scene.*\.pck$/i, "scene.pck");
	const gameexe = ordered(/^gameexe.*\.dat$/i, "gameexe.dat");
	const executable = ordered(/^siglusengine.*\.exe$/i, "siglusengine.exe");
	return {
		...(scene === undefined ? {} : { scene }),
		...(gameexe === undefined ? {} : { gameexe }),
		...(executable === undefined ? {} : { executable }),
		namesMatched:
			scene !== undefined || gameexe !== undefined || executable !== undefined,
	};
}

export const siglusEngineAdapter: EngineAdapter = {
	descriptor: {
		id: "siglus",
		version: "1",
		displayName: "SiglusEngine",
		supportedProfiles: ["scene-header-92"],
		analyzerIds: [],
	},
	async probe(context: EngineProbeContext): Promise<EngineProbeResult> {
		const found = await candidates(context);
		let bytesRead = 0n;
		const consume = (bytes: number) => {
			bytesRead += BigInt(bytes);
			if (bytesRead > context.maxInputBytes)
				throw new GarbroError(
					"LIMIT_EXCEEDED",
					"Engine probe input budget exceeded",
				);
		};
		const evidence: EngineProbeEvidence[] = [];
		const warnings: string[] = [];
		let sceneValid = false;
		let gameexeValid = false;
		if (found.scene) {
			const header = await readPrefix(
				found.scene,
				SCENE_HEADER_SIZE,
				context,
				consume,
			);
			sceneValid = validSceneHeader(header, found.scene.size);
			if (sceneValid)
				evidence.push({
					source: {
						rootId: context.game.rootId,
						path: childPath(context.game.path, found.scene.name),
					},
					kind: "structure",
					description: "Validated the 92-byte Scene package section table.",
				});
		}
		if (found.gameexe) {
			const prefix = await readPrefix(
				found.gameexe,
				GAMEEXE_PREFIX_SIZE,
				context,
				consume,
			);
			gameexeValid = validGameexePrefix(prefix);
			if (gameexeValid)
				evidence.push({
					source: {
						rootId: context.game.rootId,
						path: childPath(context.game.path, found.gameexe.name),
					},
					kind: "structure",
					description: "Validated the Gameexe container version prefix.",
				});
		}
		if (found.executable && context.allowExecutableInspection) {
			if (await validPortableExecutable(found.executable, context, consume))
				evidence.push({
					source: {
						rootId: context.game.rootId,
						path: childPath(context.game.path, found.executable.name),
					},
					kind: "static-executable",
					description:
						"Validated the static DOS and PE headers without executing the file.",
				});
		} else if (found.executable) {
			warnings.push(
				"Executable inspection was not authorized; the PE file was not read.",
			);
		}

		let gameFingerprint: GameFingerprint | undefined;
		const fingerprintFiles = sceneValid
			? [
					...(found.scene ? [found.scene] : []),
					...(found.gameexe && gameexeValid ? [found.gameexe] : []),
				]
			: [];
		const fingerprintBytes = fingerprintFiles.reduce(
			(total, file) => total + file.size,
			0n,
		);
		if (
			fingerprintFiles.length > 0 &&
			bytesRead + fingerprintBytes <= context.maxInputBytes
		) {
			gameFingerprint = await fingerprint(
				fingerprintFiles,
				context.game.path,
				context.signal,
			);
			bytesRead += fingerprintBytes;
		} else if (fingerprintFiles.length > 0)
			warnings.push(
				"The input budget was too small to compute a full game fingerprint.",
			);

		const status = sceneValid
			? "matched"
			: found.namesMatched
				? "candidate"
				: "unsupported";
		const confidence =
			sceneValid && gameexeValid ? "high" : sceneValid ? "medium" : "low";
		return {
			engineId: "siglus",
			adapterVersion: "1",
			status,
			confidence,
			...(sceneValid ? { profile: "scene-header-92" } : {}),
			...(gameFingerprint === undefined
				? {}
				: { fingerprint: gameFingerprint }),
			bytesRead,
			evidence,
			requiredInputs: [
				{
					pattern: "Scene*.pck",
					purpose: "Scene container structure and future bytecode analysis",
					required: true,
				},
				{
					pattern: "Gameexe*.dat",
					purpose: "Engine configuration and character metadata",
					required: false,
				},
				{
					pattern: "SiglusEngine*.exe",
					purpose: "Optional static key and profile evidence",
					required: false,
				},
			],
			capabilities: [
				{
					predicate: "vn:spokenBy",
					available: false,
					reason: "The Siglus dialogue analyzer is not implemented.",
				},
				{
					predicate: "vn:voiceResource",
					available: false,
					reason: "The Siglus voice binding analyzer is not implemented.",
				},
			],
			warnings,
		};
	},
};
