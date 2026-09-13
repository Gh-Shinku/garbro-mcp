import { deflateRawSync } from "node:zlib";
import { arFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

interface Entry {
	name: string;
	content: Buffer;
	/** When set the stored bytes are deflated and the entry declares method eight. */
	deflate?: boolean;
}

/**
 * Builds a stored or deflated ZIP container under an arbitrary two-byte block prefix, which is all the
 * PalmTree variant changes about the ordinary format.
 */
function buildZip(entries: readonly Entry[], prefix: string): Buffer {
	const locals: Buffer[] = [];
	const directory: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "latin1");
		const stored = entry.deflate
			? deflateRawSync(entry.content)
			: entry.content;
		const method = entry.deflate ? 8 : 0;
		const header = Buffer.alloc(30);
		header.write(`${prefix}\x03\x04`, 0, "binary");
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(method, 8);
		header.writeUInt32LE(stored.length, 18);
		header.writeUInt32LE(entry.content.length, 22);
		header.writeUInt16LE(name.length, 26);
		locals.push(header, name, stored);

		const record = Buffer.alloc(46);
		record.write(`${prefix}\x01\x02`, 0, "binary");
		record.writeUInt16LE(20, 4);
		record.writeUInt16LE(20, 6);
		record.writeUInt16LE(method, 10);
		record.writeUInt32LE(stored.length, 20);
		record.writeUInt32LE(entry.content.length, 24);
		record.writeUInt16LE(name.length, 28);
		record.writeUInt32LE(offset, 42);
		directory.push(record, name);
		offset += header.length + name.length + stored.length;
	}
	const local = Buffer.concat(locals);
	const central = Buffer.concat(directory);
	const eocd = Buffer.alloc(22);
	eocd.write(`${prefix}\x05\x06`, 0, "binary");
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(central.length, 12);
	eocd.writeUInt32LE(local.length, 16);
	return Buffer.concat([local, central, eocd]);
}

describe("PalmTree AR resource archive", () => {
	it("reads a stored and a deflated entry behind AR signatures", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: arFormat,
			archive: buildZip(
				[
					{ name: "one.dat", content: first },
					{ name: "two.dat", content: second, deflate: true },
				],
				"AR",
			),
			sourcePath: "sample.arc",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("rejects an ordinary ZIP archive", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: arFormat,
			archive: buildZip([{ name: "one.dat", content }], "PK"),
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects an archive without an end record", async () => {
		const content = Buffer.from("body");
		const archive = buildZip([{ name: "one.dat", content }], "AR");
		await expectArchive({
			format: arFormat,
			archive: archive.subarray(0, archive.length - 22),
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
