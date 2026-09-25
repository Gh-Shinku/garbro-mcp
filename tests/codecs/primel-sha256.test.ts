// The hash GARbro carries in ArcFormats/Primel/SHA256.cs, against the places an independent reading of that
// file turns out: the walk of the reference is **not** the hash of the standard, so the vectors below are
// read off a second transcription of the C# rather than off an implementation of the standard. The value of
// the standard for an empty message is pinned beside them as the value this copy does not turn out.
import { Buffer } from "node:buffer";
import { primelSha256 } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** The places of a message: the kinds the vectors below stand of, of the count of places of each. */
function message(size: number, kind: string): Buffer {
	const out = Buffer.alloc(size, 0);
	if ("fill" === kind) return out.fill(0x7a);
	if ("a" === kind) return out.fill(0x61);
	if ("q" === kind) return out.fill(0x71);
	if ("m" === kind) return out.fill(0x6d);
	if ("step7" === kind) {
		for (let i = 0; i < size; i += 1) out[i] = (i * 7) & 0xff;
		return out;
	}
	if ("range" === kind) {
		for (let i = 0; i < size; i += 1) out[i] = i & 0xff;
		return out;
	}
	if ("A" === kind) return out.fill(0x41);
	if ("abc" === kind) return Buffer.from("abc", "latin1");
	throw new Error(`no kind ${kind}`);
}

/** The places of a message and the hash the reference turns out of them. */
const VECTORS: readonly (readonly [number, string, string])[] = [
	[
		0,
		"fill",
		"f5c868940c5e3398e64e17e18b1eb7a2ab6ef2b8ec4d41a74a5227ac95e25f29",
	],
	[1, "A", "f39881295d76b9836456616a42f834b19712e1ba6a38c1c085d2b3f4cad400bd"],
	[
		3,
		"abc",
		"554144d9aa607d24ec76b3e2074dfd510cd44f895d43563b18774086195e0598",
	],
	[
		20,
		"range",
		"4464958669c583d5fb87691827b4aeaa7947cd6598a030c26f6dfbce454c7b8f",
	],
	[
		31,
		"fill",
		"3f84786adfd303a8fd5df0cd97ae76d0ec6d8daeaac59382a7b9aa3a1bed9fdf",
	],
	[
		32,
		"fill",
		"66ed6c00713fa962eb05d1e072b3f7cea8901739bc3b858713a1d4a0a5d2e569",
	],
	[55, "a", "be822b732a5c3fc4af14c8935df8dd6d003860d9dc070b1ff18e148c0ecb9bcf"],
	[56, "a", "3d9fb5db5c5cbdfd24104a131867f41d0cc64bb7ff9693696f60ce547b111d76"],
	[
		63,
		"range",
		"0c0ea79fabe804e8f7bf5c42f7f9ed0225555aa34d21dabdeabd1d2719b3d3e0",
	],
	[
		64,
		"range",
		"0e7e8a34c1993f92a3e2ee72e85e804f5c9152d73679b0cf7050eb55bfae8633",
	],
	[65, "q", "cd23748829c83c2556473a2c09e5391e6415ee466dbb2f21f2b4d568de7d6722"],
	[
		100,
		"step7",
		"9d59fb304a1d17e51f3cb77442fd1860ccf167daf96aedc82f44bc048a06ba6d",
	],
	[
		200,
		"m",
		"0cce80afd9bce4a1a0d1ffad092548e1414b909a24361a39269c46638e966c7b",
	],
];

/** The hash of the standard for an empty message, which this copy of the walk does not turn out. */
const STANDARD_EMPTY =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("the hash of the Primel engine", () => {
	it("turns out the places of the reference of every message", () => {
		for (const [size, kind, hash] of VECTORS) {
			const places = message(size, kind);
			expect(places.length).toBe(size);
			expect(primelSha256(places).toString("hex")).toBe(hash);
		}
	});

	it("stands of the words of the reference rather than of the words of the standard", () => {
		// The two rotations of the round of the reference are the ones the standard names, but the round
		// writes the first two of them as `RotL` where the standard stands of `RotR`: the hash of nothing
		// of the reference is not the hash of nothing of the standard, and a port that "fixed" it would
		// read no key of an archive of that engine.
		const empty = primelSha256(Buffer.alloc(0)).toString("hex");
		expect(empty).not.toBe(STANDARD_EMPTY);
	});

	it("turns out the places of a message of no places", () => {
		expect(() => primelSha256(Buffer.alloc(0))).not.toThrow();
		expect(primelSha256(new Uint8Array(0)).length).toBe(32);
	});
});
