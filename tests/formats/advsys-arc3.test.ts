import { encodeCp932 } from "@garbro-mcp/core";
import { advSys3Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

interface Arc3Entry {
	name: string;
	content: Buffer;
}

function buildArc3(entries: readonly Arc3Entry[]): Buffer {
	const parts = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const header = Buffer.alloc(10);
		header.writeUInt32LE(entry.content.length, 0);
		header.writeUInt16LE(name.length, 8);
		return Buffer.concat([header, name, entry.content]);
	});
	return Buffer.concat([...parts, Buffer.alloc(4)]);
}

/** A payload whose fourth byte starts a `GWD` marker. */
function gwdPayload(body: string): Buffer {
	return Buffer.concat([
		Buffer.alloc(4),
		Buffer.from("GWD", "ascii"),
		Buffer.from(body),
	]);
}

describe("AdvSys3 resource archive", () => {
	it("walks a record chain and renames GWD payloads", async () => {
		const image = gwdPayload("image data");
		const text = Buffer.from("script body");
		await expectArchive({
			format: advSys3Format,
			archive: buildArc3([
				{ name: "graphic.g", content: image },
				{ name: "main.adv", content: text },
			]),
			sourcePath: "arc01.dat",
			entries: [
				{ path: "graphic.gwd", size: image.length, content: image },
				{ path: "main.adv", size: text.length, content: text },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("requires the arc file name prefix", async () => {
		const archive = buildArc3([{ name: "a.adv", content: Buffer.from("x") }]);
		await expectArchive({
			format: advSys3Format,
			archive,
			sourcePath: "data01.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload that exceeds the file", async () => {
		const archive = buildArc3([
			{ name: "a.adv", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, 0);
		await expectArchive({
			format: advSys3Format,
			archive,
			sourcePath: "arc01.dat",
			detected: false,
			entries: [],
		});
	});
});
