// The core of the rUGP object manager, against runs written in the test: the primitives of the stream, the
// tags of the classes of an object graph, the tree the engine scrambles a class name with, and the payload
// walk of an `.ici` file. The run of the `.ici` walk and the names of the tree are pinned off a second
// transcription of `ArcRIO.cs` written apart from the port (a Python mirror), and the places of an object of
// an encrypted archive are worked out here rather than read off the port.
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	decodeRioClassName,
	decodeRioOffset,
	decodeRioSize,
	decryptRioIci,
	RIO_ENCRYPTED_SIGNATURE,
	RIO_ICI_KEY,
	RIO_SIGNATURE,
	readRioBool,
	readRioCount,
	readRioEncrypted,
	readRioShortCount,
	readRioString,
	RioClassReader,
	RioStream,
} from "../../packages/formats/src/rugp/rio-core.js";

/** The run of the `.ici` walk of the test, of the places of a count read off the walk itself. */
function iciRun(count: number): Buffer {
	return Buffer.from(
		[...Array(count).keys()].map((at) => (at * 11 + 3) & 0xff),
	);
}

/** The run an `.ici` payload of the test holds, of the two places the tree of its class names stands of. */
const PAYLOAD_PLAIN = Buffer.from(
	"05121f2c394653606d7a8794a1aebbc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f300",
	"hex",
);
const PAYLOAD_STORED = Buffer.from(
	"090ce66f9691d4488b10e6e0ec3245f116523a7716e16b96d42e393ef04d5b0d60d1a9ac468f76317428",
	"hex",
);

/** The tags of a stream: a word of sixteen places, and a class of the stream itself. */
function classTag(word: number): Buffer {
	const out = Buffer.alloc(2, 0x00);
	out.writeUInt16LE(word & 0xffff, 0);
	return out;
}

/** A class of the stream itself: the tag, the schema and the name. */
function streamClass(name: string, schema = 0x11): Buffer {
	const body = Buffer.alloc(4 + name.length, 0x00);
	body.writeUInt16LE(schema, 0);
	body.writeUInt16LE(name.length, 2);
	body.write(name, 4, "latin1");
	return Buffer.concat([classTag(0xffff), body]);
}

describe("rUGP object manager core", () => {
	it("reads the primitives of the stream", () => {
		const bytes = Buffer.from("0361626300fffe000000", "hex");
		const stream = new RioStream(bytes);
		// A length of one place, and then the places of a cp932 string.
		expect(readRioString(stream)).toBe("abc");
		// A length of nothing names a string of no places at all.
		expect(readRioString(stream)).toBe("");
		// A length of `0xFF` stands of a count of sixteen places; `0xFFFE` names a string of the platform.
		const wide = new RioStream(Buffer.from("ff040041424344", "hex"));
		expect(readRioString(wide)).toBe("ABCD");
		const platform = new RioStream(Buffer.from("fffe", "hex"));
		expect(readRioString(platform)).toBeUndefined();
		// A stream that ends within the places of a string is turned away rather than read past them.
		const short = new RioStream(Buffer.from("05ab", "hex"));
		expect(readRioString(short)).toBeUndefined();
		// The counts, of one place and of two.
		const counts = new RioStream(
			Buffer.from("0300ffff050000000aff0200", "hex"),
		);
		expect(readRioCount(counts)).toBe(3);
		expect(readRioCount(counts)).toBe(5);
		expect(readRioShortCount(counts)).toBe(10);
		expect(readRioShortCount(counts)).toBe(2);
		// The booleans, the four byte places and the eight byte places.
		const other = new RioStream(Buffer.from("0001", "hex"));
		expect(readRioBool(other)).toBe(false);
		expect(readRioBool(other)).toBe(true);
		expect(readRioBool(other)).toBeUndefined();
	});

	it("reads the tags of the classes of an object graph", () => {
		const reader = new RioClassReader();
		// A class of the stream itself: the tag of it, the schema and the name, and then a tag that names it
		// again of the count of the classes of the archive.
		const stream = new RioStream(
			Buffer.concat([
				classTag(0x0002),
				streamClass("CS5i", 0x100),
				classTag(0x8002),
				classTag(0x7fff),
			]),
		);
		// A tag with the highest place of a place of sixteen standing of nothing names no class at all.
		expect(reader.readClass(stream)).toEqual({ className: null, tag: 2 });
		expect(reader.readClass(stream)).toEqual({
			className: "CS5i",
			tag: (0x8000 << 16) | 0x7fff,
		});
		expect(reader.objectSchema).toBe(0x100);
		expect(reader.loadCount).toBe(3);
		// The same class, of the count of the classes the archive stands of.
		expect(reader.readClass(stream)?.className).toBe("CS5i");
		// A tag of `0x7FFF` stands of a count of thirty two places.
		expect(reader.readClass(stream)?.className).toBeUndefined();
	});

	it("reads the classes a stream carries itself, scrambled", () => {
		// The mark of an encrypted archive turns the walk of the classes of the stream onto the tree of the
		// engine: the name stands scrambled behind the tag, of a count of one place.
		const encoded = Buffer.from("3c13", "hex");
		const head = Buffer.alloc(4 + 2 + 2 + 2 + 2 + 1 + encoded.length, 0x00);
		head.writeUInt32LE(RIO_ENCRYPTED_SIGNATURE, 0);
		head.writeUInt16LE(0x12, 4);
		head.writeUInt16LE(0x0000, 6);
		head.writeUInt16LE(0xffff, 8);
		head.writeUInt16LE(0x11, 10);
		head.writeUInt8(encoded.length, 12);
		encoded.copy(head, 13);
		const reader = new RioClassReader();
		const walked = reader.loadRioTypeCore(new RioStream(head));
		expect(walked?.className).toBe("CRsa");
		expect(reader.isEncrypted).toBe(true);
		expect(reader.objectSchema).toBe(0x11);
	});

	it("holds the marks and the schema of an archive", () => {
		// A mark of the archive and a place of sixteen that names no version: the walk stands two places back
		// and reads the tag of a class of the count of the archive.
		const plain = Buffer.concat([
			Buffer.from("cd326e59", "hex"),
			classTag(0x0001),
		]);
		const reader = new RioClassReader();
		const walked = reader.loadRioTypeCore(new RioStream(plain));
		expect(walked?.signature).toBe(RIO_SIGNATURE);
		expect(walked?.className).toBeNull();
		expect(reader.isEncrypted).toBe(false);
		// A mark of no class of the engine at all, and a stream that ends in the mark of one.
		expect(
			new RioClassReader().loadRioTypeCore(
				new RioStream(Buffer.from("00000000", "hex")),
			),
		).toBeUndefined();
		expect(
			new RioClassReader().loadRioTypeCore(
				new RioStream(Buffer.from("cd326e", "hex")),
			),
		).toBeUndefined();
	});

	it("walks the tree of the class names of the engine", () => {
		// The names of the engine, pinned off a second transcription of the walk: the tree stands of three
		// tables of characters, where a bit of nothing names one of the first of them, two bits of one name
		// one of the third, and the two behind them a byte of the stream itself. Every one of these names
		// stands of a whole count of bytes, so the walk of it ends where its own places end.
		expect(decodeRioClassName(Buffer.from("3c13", "hex"))).toBe("CRsa");
		expect(decodeRioClassName(Buffer.from("8410", "hex"))).toBe("Caaa");
		expect(decodeRioClassName(Buffer.from("848807", "hex"))).toBe("CaaAE");
		expect(decodeRioClassName(Buffer.from("441cc7", "hex"))).toBe("CaAAA");
		// A place of the stream itself: the places of the tree of a byte that names no character of any of the
		// three tables stand of the byte itself.
		expect(decodeRioClassName(Buffer.from("82202106", "hex"))).toBe("CAaaE");
		// A tree of no places at all reads no name.
		expect(decodeRioClassName(Buffer.alloc(0))).toBe("");
	});

	it("walks the places of an `.ici` payload", () => {
		// The three column walks of the payload, of the two accumulators between them: a run of forty two
		// places, worked out apart from this port.
		expect(decryptRioIci(iciRun(0x2a)).toString("hex")).toBe(
			"a63fe2183f5ba13fa55f3fe2183f5b183fa51886e21878e2183fe21886e21878e2a13fe25f3fe2183f0a",
		);
		expect(decryptRioIci(Buffer.alloc(0)).length).toBe(0);
		// The payload behind a head of two counts, of a key that walks a turn of its own and of a checksum of
		// sixteen places behind every run of thirty two.
		const stored = Buffer.concat([
			Buffer.from("5ca9d136cf572ec9", "hex"),
			PAYLOAD_STORED,
		]);
		const walked = readRioEncrypted(new RioStream(stored), RIO_ICI_KEY);
		expect(walked?.equals(PAYLOAD_PLAIN)).toBe(true);
		// A head whose two counts do not stand of each other, a payload that ends within its own places, and a
		// key of another archive: every one of them is turned away.
		expect(
			readRioEncrypted(
				new RioStream(Buffer.from("5ca9d136cf572ec8", "hex")),
				RIO_ICI_KEY,
			),
		).toBeUndefined();
		// A payload whose places are turned over stands of a checksum that does not.
		const turned = Buffer.from(stored);
		turned[0x0c] = ((turned[0x0c] ?? 0) ^ 0x01) & 0xff;
		expect(
			readRioEncrypted(new RioStream(turned), RIO_ICI_KEY),
		).toBeUndefined();
		expect(
			readRioEncrypted(
				new RioStream(stored.subarray(0, stored.length - 4)),
				(RIO_ICI_KEY ^ 1) >>> 0,
			),
		).toBeUndefined();
	});

	it("stands of the places of an object of an encrypted archive", () => {
		// The places of an object are held to two counts of their own, worked out here rather than read off
		// the port: a place of nothing stands of the count the walk of it stands of.
		expect(decodeRioOffset(0xa2fb6ad1 | 0)).toBe(0);
		expect(decodeRioOffset((0xa2fb6ad1 + 0x12345678) | 0)).toBe(0x12345678);
		expect(decodeRioSize(0xe7b5d9f8 | 0)).toBe(0);
		expect(decodeRioSize((0xe7b5d9f8 + 0x1234) | 0)).toBe(0x91a00000);
		// A count whose highest places stand of a picture of their own: the walk of it folds the middle
		// places into the low ones, so the result stands of the whole of the count.
		expect(decodeRioSize((0xe7b5d9f8 + 0x2000) | 0)).toBe(0xfff80001);
	});
});
