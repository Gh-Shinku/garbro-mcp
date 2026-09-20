import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	dsmClearSize,
	hasDsmByteOrderMark,
	unityDsmArchiveDescriptor,
	unityDsmArchiveFormat,
} from "../../packages/formats/src/unity/dsm-archive.js";
import { unityDsmScriptFormat } from "../../packages/formats/src/unity/dsm-script.js";

const SCRIPT = Buffer.concat([
	Buffer.from([0xef, 0xbb, 0xbf]),
	Buffer.from(
		"C3SuDvv/PREsvHysfP3RfIG/pJZyrgz4ZT1CBXUrV22bgelM+fnEGpNUFsoC2YIoG1zOhwa9/NLrpKK6rnk4/w==",
		"latin1",
	),
]);
const PLAIN = Buffer.from(
	'; UTAGE scenario\n@Scenario\nText("Hello, UTAGE!");\n',
	"utf8",
);

describe("Unity engine scenario archive", () => {
	it("reads the front of a file of its own kind", () => {
		expect(hasDsmByteOrderMark(SCRIPT)).toBe(true);
		expect(hasDsmByteOrderMark(Buffer.from("not a scenario"))).toBe(false);
		expect(hasDsmByteOrderMark(Buffer.alloc(2))).toBe(false);
	});

	it("stands how many places the clear of a file of its own kind holds", () => {
		expect(dsmClearSize(92)).toBe(69);
		expect(dsmClearSize(95)).toBe(69);
		expect(dsmClearSize(0)).toBe(0);
	});

	it("reads a scenario of its own kind only where its places begin with the places of a text", async () => {
		expect(
			await unityDsmArchiveFormat.detect(
				new BufferByteSource(SCRIPT),
				"game/data.dsm",
			),
		).toBe(true);
		// A file of the same name whose places do not begin with them stands as a script of its own, which
		// the reference names the same file as.
		const bare = new BufferByteSource(SCRIPT.subarray(3));
		expect(await unityDsmArchiveFormat.detect(bare, "game/data.dsm")).toBe(
			false,
		);
		expect(await unityDsmScriptFormat.detect(bare, "game/data.dsm")).toBe(true);
		expect(
			await unityDsmArchiveFormat.detect(
				new BufferByteSource(SCRIPT),
				"game/other.dsm",
			),
		).toBe(false);
	});

	it("reads the file a scenario of its own kind holds", async () => {
		const handle = await unityDsmArchiveFormat.open(
			new BufferByteSource(SCRIPT),
			"game/data.dsm",
		);
		expect(handle.entries.length).toBe(1);
		expect(handle.entries[0]?.path).toBe("data.txt");
		expect(handle.entries[0]?.size).toBe(BigInt(dsmClearSize(SCRIPT.length)));
		expect(handle.entries[0]?.metadata).toMatchObject({ type: "script" });
		expect(handle.metadata).toMatchObject({ script: "dsm", encrypted: true });
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body).toEqual(PLAIN);
	});

	it("stands before the kind that reads the same file as a script of its own", () => {
		expect(unityDsmArchiveDescriptor.id).toBe("unity-dsm-archive");
		expect(unityDsmArchiveFormat.detection).toMatchObject({
			signatures: [],
			priority: 10,
			extensionFallback: true,
		});
	});
});
