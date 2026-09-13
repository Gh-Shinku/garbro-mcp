import { inflateRiddleCmp } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";
describe("Riddle CMP", () => {
	it("decodes MSB literals", () => {
		expect(inflateRiddleCmp(Buffer.from([0xa0, 0xd1, 0x00]), 2)).toEqual(
      Buffer.from("AD"),
		);
	});
});
