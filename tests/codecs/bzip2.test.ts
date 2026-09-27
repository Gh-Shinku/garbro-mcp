// The walk of the compressed streams of bzip2 (`packages/codecs/src/bzip2.ts`), against streams the
// reference stands of through a library (`ICSharpCode.SharpZipLib.BZip2.BZip2InputStream`): the worked
// example of the description of the wire format, and two streams written by `bzip2` itself.
import { Buffer } from "node:buffer";
import { decompressBzip2, unescapeBzip2Runs } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** The places of a file of the walk of the counts of them, of a walk of them of every count of the places. */
function runsSource(): Buffer {
	const one = Buffer.concat([
		Buffer.from("AAAA", "latin1"),
		Buffer.from([7]),
		Buffer.from("BBBB", "latin1"),
		Buffer.from([0]),
		Buffer.from("CCCD", "latin1"),
		Buffer.alloc(500, 0x78),
		Buffer.from("\n", "latin1"),
	]);
	return Buffer.concat(Array.from({ length: 40 }, () => one));
}

/** A file of more than one count of the places of a block, of the counts of the places of a block of one. */
function multiSource(): Buffer {
	return Buffer.concat(
		Array.from({ length: 4000 }, () =>
			Buffer.from(
				"the places of the file of the walk of the counts of them\n",
				"latin1",
			),
		),
	);
}

const CANONICAL =
	"425a683931415926535976a709950000008180380010002000219a68334d3091e2ee48a70a120ed4e132a0";
const RUNS =
	"QlpoOTFBWSZTWRfRomoAALPEgMCQPAAAQCAIIABQgBgFKppkYyJkTATYmBVoTIq0JoT4VcE2JwCdF3JFOFCQF9Giag==";
const MULTI =
	"QlpoMTFBWSZTWQ1UTiYArrhRgAAQQAArb86AMAEwAU0yMTExBNVJA2p6jTIU0yMTExPciJ4pETMiJxIibSImJETEiJvUiJiRE1IidSImZETMiJqkRO8iJiFSlqRExxUiJ3kROSqUqzIieZETmRE/SImZETUiJ1Iib1IiakRMSInaREzIibUiJtyoibUiJjqRE+SInaRE/mKCskyms7yrJJ4ANtCjAAAggABW350AYAJgAppkYmJiCaqKaD0QZCmmRiYmJvIid6RE1IifZETMiJiRExIicaqREzIiZkROpETUiJqRE4pETaRExCpS4kRPtSIm0iJzKpSrUiJ4kROSIn6RE1IicSInUiJ6qRE3kRMERO0iJqREzSInMiJikROpET3IiZkRP5igrJMprKT0El4ABrmowAAIIAAVt+dAGACIAU0yMTExBNVJGjaEMhTTIxMTE3ohrUQzRD7RDSiGKIYJDaqIYohwSHruiGaIZohxUQ1ohgqhcUQ+1RDzRDoiit6IeqIdEh+ohmiHNEO6IbVRDeiGCQ8UQzRDSoh8JDFRDuiHNENKIfxdyRThQkMASOLs";

describe("bzip2 streams", () => {
	it("reads the worked example of the format, of the places of the file of it", () => {
		// The example of the description of the wire format (`std/bzip2` of `google/wuffs`): the six places
		// of the file `abraca` stand of forty three places of the file of the format.
		const stream = Buffer.from(CANONICAL, "hex");
		expect(decompressBzip2(stream).toString("latin1")).toBe("abraca");
	});

	it("reads the places of the file of the walk of the counts of them", () => {
		const places = decompressBzip2(Buffer.from(RUNS, "base64"));
		expect(places.equals(runsSource())).toBe(true);
		// The places of a file of the walk of the counts of them, of the example of the description of the
		// format: `AAAA\x03` stands of seven places of the file `A`, `BBBB\x00` of four of `B`.
		expect(
			unescapeBzip2Runs(Buffer.from("AAAA\x03BBBB\x00CCCD", "latin1")).toString(
				"latin1",
			),
		).toBe("AAAAAAABBBBCCCD");
	});

	it("reads a file of more than one count of the places of a block", () => {
		const places = decompressBzip2(Buffer.from(MULTI, "base64"));
		expect(places.length).toBe(multiSource().length);
		expect(places.equals(multiSource())).toBe(true);
	});

	it("reads no stream of no head of the format, and none of counts that stand of no count of their own", () => {
		expect(() =>
			decompressBzip2(Buffer.from("not a stream", "latin1")),
		).toThrow();
		expect(() => decompressBzip2(Buffer.from("BZh9", "latin1"))).toThrow();
		const stream = Buffer.from(RUNS, "base64");
		expect(() => decompressBzip2(stream.subarray(0, 20))).toThrow();
		const broken = Buffer.from(stream);
		const last = broken.length - 1;
		broken[last] = (broken[last] ?? 0) ^ 0xff;
		expect(() => decompressBzip2(broken)).toThrow();
	});
});
