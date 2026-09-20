import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decryptDsm,
	dsmKeyAndIv,
	hasDsmName,
	unityDsmScriptDescriptor,
	unityDsmScriptFormat,
} from "../../packages/formats/src/unity/dsm-script.js";

const SCRIPT = Buffer.from(
	"C3SuDvv/PREsvHysfP3RfIG/pJZyrgz4ZT1CBXUrV22bgelM+fnEGpNUFsoC2YIoG1zOhwa9/NLrpKK6rnk4/w==",
	"latin1",
);
const PLAIN = Buffer.from(
	'; UTAGE scenario\n@Scenario\nText("Hello, UTAGE!");\n',
	"utf8",
);

describe("UTAGE Unity engine script file", () => {
	it("stands the key of a script of its own kind from the words of the reference", () => {
		const { key, iv } = dsmKeyAndIv();
		expect(key.toString("hex")).toBe(
			"05f78f5953bfabb1be2d840cb0e13db65f7fa5efc97fbaa6300ca4e533fa717c",
		);
		expect(iv.toString("hex")).toBe("e93ecc7c6e394f3d432282ef185cc3b1");
	});

	it("stands the places of a script in the clear under the key of the reference", () => {
		expect(decryptDsm(SCRIPT)).toEqual(PLAIN);
	});

	it("reads the places of a script that stand as a text of the kind it stands as", () => {
		const broken = Buffer.from(
			`${SCRIPT.subarray(0, 40).toString("latin1")}\n${SCRIPT.subarray(40).toString("latin1")}`,
			"latin1",
		);
		expect(decryptDsm(broken)).toEqual(PLAIN);
	});

	it("turns away a script whose places do not stand as the places of a ciphered block", () => {
		expect(() =>
			decryptDsm(Buffer.from("not a ciphered block", "utf8")),
		).toThrow();
		expect(() => decryptDsm(Buffer.alloc(0))).toThrow();
		expect(() => decryptDsm(Buffer.from("!!!!", "utf8"))).toThrow();
	});

	it("turns away a script whose places do not stand in the clear", () => {
		// The places of a ciphered block stand in whole blocks of the standard cipher.
		const short = Buffer.from(SCRIPT.toString("latin1").slice(0, 20), "latin1");
		expect(() => decryptDsm(short)).toThrow();
	});

	it("reads a script of its own kind only where its name stands as the name of one", async () => {
		expect(hasDsmName("game/data.dsm")).toBe(true);
		expect(hasDsmName("game\\DATA.DSM")).toBe(true);
		expect(hasDsmName("game/other.dsm")).toBe(false);
		expect(
			await unityDsmScriptFormat.detect(
				new BufferByteSource(SCRIPT),
				"game/data.dsm",
			),
		).toBe(true);
		expect(
			await unityDsmScriptFormat.detect(
				new BufferByteSource(SCRIPT),
				"game/other.dsm",
			),
		).toBe(false);
		expect(
			await unityDsmScriptFormat.detect(
				new BufferByteSource(Buffer.from("not a script at all")),
				"game/data.dsm",
			),
		).toBe(false);
	});

	it("hands out the places of a script as a text of its own", async () => {
		expect(unityDsmScriptDescriptor.id).toBe("unity-dsm-script");
		const handle = await unityDsmScriptFormat.open(
			new BufferByteSource(SCRIPT),
			"game/data.dsm",
		);
		expect(handle.entries[0]?.path).toBe("data.txt");
		expect(handle.entries[0]?.metadata).toMatchObject({ type: "script" });
		expect(handle.metadata).toMatchObject({ script: "dsm", encrypted: true });
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body).toEqual(PLAIN);
	});
});
