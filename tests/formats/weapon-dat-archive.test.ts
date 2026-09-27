// The resource archives of the engine of Weapon (GARbro "Legacy/Weapon/ArcDAT.cs", class DatOpener),
// against files built in the test: an archive of the engine stands of nothing but a list of the counts of
// the places of its pictures, which the reference itself holds, of the name of the archive.
import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	decodeWeaponPixels,
	WEAPON_TABLES,
	weaponDatFormat,
	weaponEntries,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

const PLACES_PER_PIXEL = 2;

/** The counts of the places of the pictures of `heyacg.dat`, of the table of the reference. */
const HEYACG = WEAPON_TABLES["heyacg.dat"] ?? [];
/** The count of the places of the file of every picture of `heyacg.dat`. */
const HEYACG_PICTURE = 236 * 174 * PLACES_PER_PIXEL;
/** The count of the places of the file of the whole archive of `heyacg.dat`. */
const HEYACG_SIZE = HEYACG.length * HEYACG_PICTURE;

/** The places of the file of an archive, filled of a walk of the counts of the places of it. */
function archive(count: number): Buffer {
	const out = Buffer.alloc(count, 0x00);
	for (let at = 0; at < count; at += 1) out[at] = (at * 7) & 0xff;
	return out;
}

describe("Weapon resource archive", () => {
	it("reads the lists of the places of the pictures of the engine", () => {
		expect(Object.keys(WEAPON_TABLES)).toEqual([
			"eventcg.dat",
			"buy.dat",
			"heyacg.dat",
			"kigaecg.dat",
			"chibicg.dat",
			"omake.dat",
			"result.dat",
			"title.dat",
		]);
		expect(Object.values(WEAPON_TABLES).map((table) => table.length)).toEqual([
			69, 149, 14, 148, 464, 219, 6, 2,
		]);
		// Two lists of pictures, of the reference as they stand there.
		expect(WEAPON_TABLES["title.dat"]).toEqual([
			[800, 1076],
			[800, 600],
		]);
		expect(WEAPON_TABLES["result.dat"]).toEqual([
			[528, 600],
			[528, 600],
			[272, 600],
			[272, 600],
			[272, 600],
			[272, 600],
		]);
		expect(WEAPON_TABLES["heyacg.dat"]).toEqual(
			Array.from({ length: 14 }, () => [236, 174]),
		);
	});

	it("reads the places of the pictures of an archive of a name of the engine", async () => {
		const table = weaponEntries("/tmp/heyacg.dat", BigInt(HEYACG_SIZE));
		if (!table) throw new Error("no places of a picture");
		expect(table.length).toBe(14);
		expect(table[0]).toEqual({
			width: 236,
			height: 174,
			offset: 0n,
			size: 82128n,
		});
		expect(table[13]).toEqual({
			width: 236,
			height: 174,
			offset: 1067664n,
			size: 82128n,
		});
		const source = new BufferByteSource(archive(HEYACG_SIZE));
		expect(await weaponDatFormat.detect(source, "/tmp/heyacg.dat")).toBe(true);
		const handle = await weaponDatFormat.open(source, "/tmp/heyacg.dat");
		try {
			expect(handle.entries.length).toBe(14);
			expect(handle.entries[0]?.path).toBe("heyacg#0000");
			expect(handle.entries[13]?.path).toBe("heyacg#0013");
			expect(handle.entries[13]?.size).toBe(82128n);
			// The places of a picture stand of the places of the colours of a picture of the engine, of two
			// places of the file for every place of the picture, being a picture of `Bgr555`.
			const picture = await handle.openEntry(handle.entries[0]?.id ?? "0");
			const chunks: Buffer[] = [];
			for await (const chunk of picture) chunks.push(Buffer.from(chunk));
			const bmp = Buffer.concat(chunks);
			expect(bmp.readUInt32LE(18)).toBe(236);
			// A picture of the engine stands of the places of its own rows from the first of them, and the
			// head of the picture stands of that of the counts of the places of a row that names it.
			expect(bmp.readInt32LE(22)).toBe(-174);
			expect(bmp.readUInt16LE(28)).toBe(16);
			expect(bmp.readUInt32LE(10)).toBe(66);
			// The first two places of the picture stand of the places of the file `00 07` and `0e 15`, of the
			// colours `01 03` and `05 39`: of the arithmetic of `CgDecoder.GetImageData`, worked out here by
			// hand, `high = (first << 2) | (second & 3)` and `low = (second >> 2) | (first & ~0x1f)`.
			expect([...bmp.subarray(66, 70)]).toEqual([0x01, 0x03, 0x05, 0x39]);
			// The last place of the picture stands of the places of the file `a2 a9`, of the colours
			// `aa 89`: of the same arithmetic, by hand.
			const last = 66 + HEYACG_PICTURE - 2;
			expect([...bmp.subarray(last, last + 2)]).toEqual([0xaa, 0x89]);
		} finally {
			await handle.close();
		}
	});

	it("reads no archive of a name the reference holds no list of, and no short archive", async () => {
		const other = new BufferByteSource(archive(0x1000));
		expect(await weaponDatFormat.detect(other, "/tmp/other.dat")).toBe(false);
		// An archive of a name of the engine stands of the whole list of its pictures: the places of the
		// last picture of it have to stand within the file.
		const short = new BufferByteSource(archive(HEYACG_SIZE - 1));
		expect(await weaponDatFormat.detect(short, "/tmp/heyacg.dat")).toBe(false);
		expect(await weaponEntries("/tmp/eventcg.dat", 0x1000n)).toBeUndefined();
		// The name of an archive of the engine stands of no count of the places of the file: the walk of
		// the places of its pictures stands of the name alone, of no sign of the places of the file.
		const upper = new BufferByteSource(archive(HEYACG_SIZE));
		expect(await weaponDatFormat.detect(upper, "/tmp/HEYACG.DAT")).toBe(true);
	});

	it("reads the places of the colours of a picture of an odd count of no place of its own", () => {
		expect([
			...decodeWeaponPixels(Buffer.from([0x00, 0x07, 0x0e, 0x15])),
		]).toEqual([0x01, 0x03, 0x05, 0x39]);
		expect([...decodeWeaponPixels(Buffer.from([0xff, 0xff]))]).toEqual([
			0xff, 0xff,
		]);
		expect([...decodeWeaponPixels(Buffer.from([0x1f, 0x00]))]).toEqual([
			0x00, 0x7c,
		]);
		expect(() => decodeWeaponPixels(Buffer.from([0x00]))).toThrow(GarbroError);
	});
});
