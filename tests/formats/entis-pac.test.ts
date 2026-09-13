import { encodeCp932 } from "@garbro-mcp/core";
import { entisPacFormat } from "@garbro-mcp/formats";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const NAME_SIZE = 0x18;
const RECORD_SIZE = 0x20;
const DATA_BASE = 0x40000;
const PASSWORD =
	"パブロ・ディエゴ・ホセ・フランチスコ・ド・ポール・ジャン・ネボムチェーノ・クリスバン・ クリスピアノ・ド・ラ・ンチシュ・トリニダット・ルイス・イ・ピカソのシプリアーノ･サンティシマ･トリニダードは三位一体の事だったりする";

interface Entry {
	name: string;
	payload: Buffer;
	/** Payloads are written verbatim; encrypted payloads already include their zero prefix. */
}

function encryptedPayload(plain: Buffer): Buffer {
	const password = encodeCp932(PASSWORD);
	const output = Buffer.alloc(plain.length + 1);
	for (let index = 0; index < plain.length; index += 1) {
		const key = ~(password[index % password.length] ?? 0) & 0xff;
		output[index + 1] = (plain[index] ?? 0) ^ key;
	}
	return output;
}

function buildPac(entries: readonly Entry[]): Buffer {
	const payloadSize = entries.reduce(
		(total, entry) => total + entry.payload.length,
		0,
	);
	if ((entries.length + 1) * RECORD_SIZE > DATA_BASE)
		throw new Error("index would overlap the payload base");
	const archive = Buffer.alloc(DATA_BASE + payloadSize);
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		archive.write(entry.name, record, "ascii");
		archive.fill(0x20, record + entry.name.length, record + NAME_SIZE);
		archive.writeUInt32LE(offset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.payload.length, record + NAME_SIZE + 4);
		entry.payload.copy(archive, DATA_BASE + offset);
		offset += entry.payload.length;
	}
	// Terminator: a name field whose first byte is a space ends the list.
	archive.fill(
		0x20,
		entries.length * RECORD_SIZE,
		entries.length * RECORD_SIZE + NAME_SIZE,
	);
	return archive;
}

describe("Terios PAC resource archive", () => {
	it("extracts stored and password-xored entries", async () => {
		const raw = Buffer.from("RIFF stored payload");
		const plain = Buffer.from("encrypted payload");
		await expectArchive({
			format: entisPacFormat,
			archive: buildPac([
				{ name: "raw.dat", payload: raw },
				{ name: "hidden.dat", payload: encryptedPayload(plain) },
			]),
			sourcePath: "sample.pac",
			entries: [
				{ path: "raw.dat", size: raw.length, content: raw },
				{ path: "hidden.dat", size: plain.length, content: plain },
			],
			metadata: { entryCount: 2, encryption: "password-xor" },
		});
	});

	it("cycles the password across entries", async () => {
		const password = encodeCp932(PASSWORD);
		if (password.length !== 217)
			throw new Error(`Unexpected password length: ${password.length}`);
		const plain = Buffer.alloc(600);
		for (let index = 0; index < plain.length; index += 1) {
			plain[index] = index & 0xff;
		}
		await expectArchive({
			format: entisPacFormat,
			archive: buildPac([
				{ name: "long.dat", payload: encryptedPayload(plain) },
			]),
			sourcePath: "sample.pac",
			entries: [{ path: "long.dat", size: plain.length, content: plain }],
		});
	});

	it("requires the pac extension", async () => {
		await expectArchive({
			format: entisPacFormat,
			archive: buildPac([{ name: "a.dat", payload: Buffer.from("x") }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a name field with a control byte", async () => {
		const archive = buildPac([{ name: "a.dat", payload: Buffer.from("x") }]);
		archive[4] = 0x01;
		await expectArchive({
			format: entisPacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});

	it("rejects a name that fills its field", async () => {
		const archive = buildPac([{ name: "abcdefgh", payload: Buffer.from("x") }]);
		archive.fill(0x41, 0, NAME_SIZE);
		await expectArchive({
			format: entisPacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});
});
