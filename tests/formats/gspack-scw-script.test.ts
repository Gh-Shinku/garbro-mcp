// The GsWin script format (GARbro "ArcFormats/GsPack/ArcGsPack.cs", class GsScriptFormat), against files
// built in the test. The reference carries no walk of the places of such a script: it names the file, of one
// of three words at its head, and hands the places of it over as they stand.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { gsPackScwScriptFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

async function archiveOf(data: Buffer, path = "sample.scw") {
	const source = new BufferByteSource(data);
	const detected = await gsPackScwScriptFormat.detect(source, path);
	return { detected, handle: await gsPackScwScriptFormat.open(source, path) };
}

describe("GsWin engine script", () => {
	it("stands of the three words the head of a script of the engine may stand of", async () => {
		for (const head of ["SCW ", "Scw5", "Scw4"]) {
			const data = Buffer.concat([
				Buffer.from(head, "latin1"),
				Buffer.from("a line of the script\n", "latin1"),
			]);
			const { detected } = await archiveOf(data);
			expect(detected).toBe(true);
		}
		// A file of another word at its head, and a file standing short of one, stand of no script.
		for (const data of [
			Buffer.from("SCX ", "latin1"),
			Buffer.from("Sc", "latin1"),
		]) {
			expect(
				await gsPackScwScriptFormat.detect(
					new BufferByteSource(data),
					"other.scw",
				),
			).toBe(false);
		}
	});

	it("names the places of the script and hands them over as they stand", async () => {
		const data = Buffer.concat([
			Buffer.from("Scw5", "latin1"),
			Buffer.from("\\u3042\\u3044\r\n", "latin1"),
			Buffer.from([0x00, 0x01, 0x02, 0xff]),
		]);
		const { handle } = await archiveOf(data, "C:\\game\\scenario\\first.scw");
		try {
			expect(handle.entries.length).toBe(1);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			expect(entry.path).toBe("first.txt");
			expect(entry.metadata).toMatchObject({ type: "script" });
			expect(handle.metadata).toMatchObject({ script: "scw" });
			// The whole file stands over, of the word at its head and all: the reference stands of
			// `GenericScriptFormat.ConvertFrom`, which hands the places over as they stand.
			expect(await consumeBuffer(await handle.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await handle.close();
		}
	});
});
