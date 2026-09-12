import { flkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const BASE = 0x100;

/**
 * Encodes the bit-packed next-offset field. The first descriptor contributes its high byte to the
 * archive base offset instead of the offset value, so `useHighByte` is false there.
 */
function setNextOffset(
	buffer: Buffer,
	nextOffset: number,
	useHighByte: boolean,
): void {
	const value = nextOffset - BASE;
	buffer[0] = (value >> 4) & 0xff;
	buffer[1] = (value >> 12) & 0xff;
	buffer[3] = useHighByte ? BASE >> 8 : (value >> 20) & 0xff;
}

function setDescriptor(buffer: Buffer, name: string): void {
	buffer.write(name, 4, "ascii");
	buffer[4 + name.length] = 0;
}

describe("Liddell FLK archive", () => {
	it("reads the bit-packed 0x10-byte descriptor chain", async () => {
		const first = Buffer.alloc(0x10);
		setNextOffset(first, 0x100, true);
		setDescriptor(first, "a.bin");
		const second = Buffer.alloc(0x10);
		setNextOffset(second, 0x120, false);
		setDescriptor(second, "b.bin");
		const terminator = Buffer.alloc(0x10);
		setNextOffset(terminator, 0x140, false);
		const archive = Buffer.concat([
			first,
			second,
			terminator,
			Buffer.alloc(BASE - 0x30),
			Buffer.alloc(0x20, 0x41),
			Buffer.alloc(0x20, 0x42),
		]);
		await expectArchive({
			format: flkFormat,
			archive,
			sourcePath: "data.flk",
			entries: [
				{ path: "a.bin", size: 0x20, content: Buffer.alloc(0x20, 0x41) },
				{ path: "b.bin", size: 0x20, content: Buffer.alloc(0x20, 0x42) },
			],
			metadata: { entryCount: 2 },
		});
	});
});
