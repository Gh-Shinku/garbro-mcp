#!/usr/bin/env node

import {
	asGarbroError,
	detectionToWire,
	entryToWire,
	extractArchive,
	extractEntry,
	formatToWire,
	type ArchiveHandle,
} from "@garbro-mcp/core";
import { createDefaultRegistry } from "@garbro-mcp/formats";
import { Command, CommanderError } from "commander";

const registry = createDefaultRegistry();

function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function withArchive<T>(
	path: string,
	run: (archive: ArchiveHandle) => Promise<T>,
): Promise<T> {
	const archive = await registry.openArchive(path);
	try {
		return await run(archive);
	} finally {
		await archive.close();
	}
}

const program = new Command()
	.name("garbro-mcp")
	.description("Detect, inspect, and extract ADV/Galgame resource archives")
	.version("0.0.0")
	.showHelpAfterError()
	.exitOverride();

program
	.command("detect")
	.description("Detect an archive format")
	.argument("<archive>", "archive path")
	.option("--json", "emit JSON")
	.action(async (path: string, options: { json?: boolean }) => {
		const detected = await registry.detectArchive(path);
		const output = detected ? detectionToWire(detected) : { detected: false };
		if (options.json) printJson(output);
		else if (detected)
			process.stdout.write(`${detected.format.id}\t${detected.format.name}\n`);
		else process.stdout.write("unknown\n");
	});

program
	.command("list")
	.description("List archive entries")
	.argument("<archive>", "archive path")
	.option("--json", "emit JSON")
	.action(async (path: string, options: { json?: boolean }) => {
		await withArchive(path, async (archive) => {
			if (options.json) {
				printJson({
					archivePath: archive.sourcePath,
					archiveSize: archive.size.toString(),
					format: formatToWire(archive.format),
					metadata: archive.metadata,
					entries: archive.entries.map(entryToWire),
				});
			} else {
				for (const entry of archive.entries) {
					process.stdout.write(`${entry.id}\t${entry.size}\t${entry.path}\n`);
				}
			}
		});
	});

program
	.command("extract-entry")
	.description("Extract one archive entry by its listed ID")
	.argument("<archive>", "archive path")
	.argument("<entry-id>", "entry ID shown by the list command")
	.requiredOption("-o, --output <directory>", "output directory")
	.option("--overwrite", "replace an existing regular file")
	.option("--json", "emit JSON")
	.action(
		async (
			path: string,
			entryId: string,
			options: { output: string; overwrite?: boolean; json?: boolean },
		) => {
			await withArchive(path, async (archive) => {
				const result = await extractEntry(archive, entryId, {
					outputDirectory: options.output,
					overwrite: options.overwrite ?? false,
				});
				const output = {
					archivePath: archive.sourcePath,
					outputPath: result.outputPath,
					bytesWritten: result.bytesWritten.toString(),
					sha256: result.sha256,
					entry: entryToWire(result.entry),
				};
				if (options.json) printJson(output);
				else process.stdout.write(`${result.outputPath}\n`);
			});
		},
	);

program
	.command("extract-archive")
	.description("Extract every archive entry")
	.argument("<archive>", "archive path")
	.requiredOption("-o, --output <directory>", "output directory")
	.option("--overwrite", "replace existing regular files")
	.option("--json", "emit JSON")
	.action(
		async (
			path: string,
			options: { output: string; overwrite?: boolean; json?: boolean },
		) => {
			await withArchive(path, async (archive) => {
				const result = await extractArchive(archive, {
					outputDirectory: options.output,
					overwrite: options.overwrite ?? false,
				});
				const output = {
					archivePath: archive.sourcePath,
					outputDirectory: result.outputDirectory,
					format: formatToWire(archive.format),
					extractedEntries: result.files.length,
					bytesWritten: result.bytesWritten.toString(),
				};
				if (options.json) printJson(output);
				else
					process.stdout.write(
						`${result.files.length} entries -> ${result.outputDirectory}\n`,
					);
			});
		},
	);

program
	.command("formats")
	.description("List supported archive formats")
	.option("--json", "emit JSON")
	.action((options: { json?: boolean }) => {
		const formats = registry.listFormats();
		if (options.json) printJson({ formats: formats.map(formatToWire) });
		else {
			for (const format of formats) {
				process.stdout.write(`${format.id}\t${format.name}\n`);
			}
		}
	});

try {
	await program.parseAsync(process.argv);
} catch (error) {
	if (error instanceof CommanderError) {
		process.exitCode = error.exitCode === 0 ? 0 : 2;
	} else {
		const garbroError = asGarbroError(error);
		process.stderr.write(`${garbroError.code}: ${garbroError.message}\n`);
		process.exitCode = 1;
	}
}
