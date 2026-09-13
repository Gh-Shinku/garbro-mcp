import { encodeCp932 } from "@garbro-mcp/core";
import { pkkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x14;
const RECORD_SIZE = 0x28;
const NAME_OFFSET = 8;
const NAME_SIZE = 0x20;
const KEY_HEX =
	"6ecd5e69c7575fb75056a850529f50529d4f519c4e4f9b4e4f9c50529c53549d" +
	"5756a15e5dad666ac26e73d37277da7578dc787cdd7b7ddd7d80dd8081dc8585" +
	"dc8788dc8a8adb8c8cda8d8ed98f8ed28f8bc79088ba9186b09386ae9285ad90" +
	"84ac8d82a98a7fa7877aa5877aa1a08e9ec6ae9ed8bc9ed4b593c8a483c29c7a" +
	"c29877c09577c09176c28d76c68b76c58673c48271c27e71c17d72bf7b71bd79" +
	"70bb7870bb7770ba7571b87571b87571b77570b6736fb3716fb2706fb17070b1" +
	"6f71af6e72ae6e72af6d74b06d74b06c74b06c74b16c76b26d77b56e7ab36d7a" +
	"b26b79b36c7a5552955854955a55975b57975c57965f5797605998625a98635a" +
	"98635a98655b97655b97665b96665a9566599467599467599467589366579164" +
	"578f63568f63548e61518e5e4e8c5b4c8b5748895144874a3f83453a803d327d" +
	"372d7b3128772b2375231c6f1b186a16146614136411126011116011125f1111" +
	"5d0f115d11115e11115f14126014136117146217156015135e1010550f0e520f" +
	"0e540f0e56110e530f0d4b10104a15135419176117145f15105c150f5b150f5b" +
	"120f5b110f5c110f5c110f5b100f5c100f5d0f0f5d0f0f5d0f0f5d0f0f5d0f0f" +
	"5c0f0f5b0f0f5b0f0f5a0f0f590f0f590f0f5c0f0f5c0f0f5d0f0f5d0f0f5d0f" +
	"0f5f0f10600f10600f10610f10640f106611116712116813116914116a15116a";
("");

/** The same 0x200-byte repeating key the reference uses, transcribed from the port's table. */
const KEY = Buffer.from(KEY_HEX, "hex");

function crypt(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1)
		output[index] = (output[index] ?? 0) ^ (KEY[index % KEY.length] ?? 0);
	return output;
}

interface Entry {
	name: string;
	content: Buffer;
}

/** Header, index and payloads are each encrypted on their own, so every buffer restarts the key. */
function buildPkk(entries: readonly Entry[], version = 0): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const indexOffset = HEADER_SIZE;
	const dataOffset = indexOffset + indexSize;
	const header = Buffer.alloc(HEADER_SIZE);
	header.writeUInt32LE(version, 0);
	header.writeUInt32LE(indexOffset, 0xc);
	header.writeInt32LE(entries.length, 0x10);
	const index = Buffer.alloc(indexSize);
	const payloads: Buffer[] = [];
	let relative = 0;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		index.writeUInt32LE(entry.content.length, record);
		index.writeUInt32LE(relative, record + 4);
		encodeCp932(entry.name).copy(index, record + NAME_OFFSET);
		payloads.push(crypt(entry.content));
		relative += entry.content.length;
	}
	return Buffer.concat([crypt(header), crypt(index), ...payloads]);
}

describe("Electriciteit PKK resource archive", () => {
	it("decrypts the header, index and payloads", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: pkkFormat,
			archive: buildPkk([
				{ name: "one.pkk", content: first },
				{ name: "two.pkk", content: second },
			]),
			sourcePath: "sample.pkk",
			entries: [
				{ path: "one.pkk", size: first.length, content: first },
				{ path: "two.pkk", size: second.length, content: second },
			],
		});
	});

	it("accepts the second version word", async () => {
		const content = Buffer.from("version one");
		await expectArchive({
			format: pkkFormat,
			archive: buildPkk([{ name: "one.pkk", content }], 1),
			sourcePath: "sample.skn",
			entries: [{ path: "one.pkk", size: content.length, content }],
		});
	});

	it("rejects an unknown version word", async () => {
		const content = Buffer.from("x");
		await expectArchive({
			format: pkkFormat,
			archive: buildPkk([{ name: "one.pkk", content }], 2),
			sourcePath: "sample.pkk",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index offset inside the header", async () => {
		const content = Buffer.from("x");
		const archive = buildPkk([{ name: "one.pkk", content }]);
		const header = crypt(archive.subarray(0, HEADER_SIZE));
		header.writeUInt32LE(4, 0xc);
		crypt(header).copy(archive, 0);
		await expectArchive({
			format: pkkFormat,
			archive,
			sourcePath: "sample.pkk",
			detected: false,
			entries: [],
		});
	});
});
