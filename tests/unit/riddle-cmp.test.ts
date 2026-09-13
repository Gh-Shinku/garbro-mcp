import { inflateRiddleCmp } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";
describe("Riddle CMP", () => {
	it("decodes MSB literals", () => {
		expect(inflateRiddleCmp(Buffer.from([0xa0, 0xd1, 0x00]), 2)).toEqual(
			Buffer.from("AD"),
		);
	});

	it("preserves GARBro's partly zero-filled initial frame", () => {
		expect(inflateRiddleCmp(Buffer.from([0x7e, 0xf0]), 2)).toEqual(
			Buffer.alloc(2),
		);
		expect(inflateRiddleCmp(Buffer.from([0x00, 0x00]), 2)).toEqual(
			Buffer.from("  "),
		);
	});
});
