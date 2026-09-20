import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeGrd,
	grdKey,
	readGrdLayout,
	studioJikkenshitsuGrdImageDescriptor,
	studioJikkenshitsuGrdImageFormat,
} from "../../packages/formats/src/studio-jikkenshitsu/grd-image.js";

/** A Studio Jikkenshitsu picture: the head, the places of the picture under a walk of the LZSS kind, and the
 * shape of those places behind them. */
function grdFile(input: {
	bitsPerPixel?: number;
	width?: number;
	height?: number;
	flags?: number;
	packed?: Buffer;
	alpha?: Buffer;
	word?: string;
	packedLength?: number;
	alphaLength?: number;
}): Buffer {
	const head = Buffer.alloc(0x18, 0x00);
	head.write(input.word ?? "GRD ", 0, "latin1");
	head[4] = input.bitsPerPixel ?? 8;
	head[5] = input.flags ?? 0;
	head.writeUInt16LE(input.width ?? 2, 6);
	head.writeUInt16LE(input.height ?? 1, 8);
	const packed = input.packed ?? Buffer.alloc(0);
	head.writeInt32LE(input.packedLength ?? packed.length, 0x0c);
	head.writeInt32LE(input.alphaLength ?? input.alpha?.length ?? 0, 0x14);
	return Buffer.concat([head, packed, input.alpha ?? Buffer.alloc(0)]);
}

/** A picture of four and twenty bits of two places, whose places stand under the standard cipher: the
 * places stand under a key of the reference's own and the walk behind them stands as the command line of the
 * standard cipher stands it, an independent transcription of the walk having worked out the places behind the
 * key. */
const ENCRYPTED = Buffer.from(
	"47524420188002000100000038000000" +
		"0000000000000000979cdfdeb74c3a52" +
		"afb90ac68d678da6f1d475f07da15dae" +
		"4f264b40135e2ebd3fee049096d893c7" +
		"7deec859446c18206350ef290dd6fc2f",
	"hex",
);

/** A picture of eight bits of four places by two, whose colours and places stand behind a walk of the LZSS
 * kind of the plain kind. */
const GREY = Buffer.from(
	"475244200800040002000000b6040000" +
		"0000000000000000ff00010203040506" +
		"07ff08090a0b0c0d0e0fff1011121314" +
		"151617ff18191a1b1c1d1e1fff202122" +
		"2324252627ff0000000001030700ff02" +
		"060e0003091500ff040c1c00050f2300" +
		"ff06122a0007153100ff08183800091b" +
		"3f00ff0a1e46000b214d00ff0c245400" +
		"0d275b00ff0e2a62000f2d6900ff1030" +
		"700011337700ff12367e0013398500ff" +
		"143c8c00153f9300ff16429a001745a1" +
		"00ff1848a800194baf00ff1a4eb6001b" +
		"51bd00ff1c54c4001d57cb00ff1e5ad2" +
		"001f5dd900ff2060e0002163e700ff22" +
		"66ee002369f500ff246cfc00256f0300" +
		"ff26720a0027751100ff28781800297b" +
		"1f00ff2a7e26002b812d00ff2c843400" +
		"2d873b00ff2e8a42002f8d4900ff3090" +
		"500031935700ff32965e0033996500ff" +
		"349c6c00359f7300ff36a27a0037a581" +
		"00ff38a8880039ab8f00ff3aae96003b" +
		"b19d00ff3cb4a4003db7ab00ff3ebab2" +
		"003fbdb900ff40c0c00041c3c700ff42" +
		"c6ce0043c9d500ff44ccdc0045cfe300" +
		"ff46d2ea0047d5f100ff48d8f80049db" +
		"ff00ff4ade06004be10d00ff4ce41400" +
		"4de71b00ff4eea22004fed2900ff50f0" +
		"300051f33700ff52f63e0053f94500ff" +
		"54fc4c0055ff5300ff56025a00570561" +
		"00ff58086800590b6f00ff5a0e76005b" +
		"117d00ff5c1484005d178b00ff5e1a92" +
		"005f1d9900ff6020a0006123a700ff62" +
		"26ae006329b500ff642cbc00652fc300" +
		"ff6632ca006735d100ff6838d800693b" +
		"df00ff6a3ee6006b41ed00ff6c44f400" +
		"6d47fb00ff6e4a02006f4d0900ff7050" +
		"100071531700ff72561e0073592500ff" +
		"745c2c00755f3300ff76623a00776541" +
		"00ff78684800796b4f00ff7a6e56007b" +
		"715d00ff7c7464007d776b00ff7e7a72" +
		"007f7d7900ff8080800081838700ff82" +
		"868e0083899500ff848c9c00858fa300" +
		"ff8692aa008795b100ff8898b800899b" +
		"bf00ff8a9ec6008ba1cd00ff8ca4d400" +
		"8da7db00ff8eaae2008fade900ff90b0" +
		"f00091b3f700ff92b6fe0093b90500ff" +
		"94bc0c0095bf1300ff96c21a0097c521" +
		"00ff98c8280099cb2f00ff9ace36009b" +
		"d13d00ff9cd444009dd74b00ff9eda52" +
		"009fdd5900ffa0e06000a1e36700ffa2" +
		"e66e00a3e97500ffa4ec7c00a5ef8300" +
		"ffa6f28a00a7f59100ffa8f89800a9fb" +
		"9f00ffaafea600ab01ad00ffac04b400" +
		"ad07bb00ffae0ac200af0dc900ffb010" +
		"d000b113d700ffb216de00b319e500ff" +
		"b41cec00b51ff300ffb622fa00b72501" +
		"00ffb8280800b92b0f00ffba2e1600bb" +
		"311d00ffbc342400bd372b00ffbe3a32" +
		"00bf3d3900ffc0404000c1434700ffc2" +
		"464e00c3495500ffc44c5c00c54f6300" +
		"ffc6526a00c7557100ffc8587800c95b" +
		"7f00ffca5e8600cb618d00ffcc649400" +
		"cd679b00ffce6aa200cf6da900ffd070" +
		"b000d173b700ffd276be00d379c500ff" +
		"d47ccc00d57fd300ffd682da00d785e1" +
		"00ffd888e800d98bef00ffda8ef600db" +
		"91fd00ffdc940400dd970b00ffde9a12" +
		"00df9d1900ffe0a02000e1a32700ffe2" +
		"a62e00e3a93500ffe4ac3c00e5af4300" +
		"ffe6b24a00e7b55100ffe8b85800e9bb" +
		"5f00ffeabe6600ebc16d00ffecc47400" +
		"edc77b00ffeeca8200efcd8900fff0d0" +
		"9000f1d39700fff2d69e00f3d9a500ff" +
		"f4dcac00f5dfb300fff6e2ba00f7e5c1" +
		"00fff8e8c800f9ebcf00fffaeed600fb" +
		"f1dd00fffcf4e400fdf7eb00fffefaf2" +
		"00fffdf900ff01020304fafbfcfd",
	"hex",
);

/** The same kind of picture with a shape of its places behind the places of the picture, the shape naming one
 * place of a colour of its own for every row. */
const SHAPED = Buffer.from(
	"475244200800020002000000b6040000" +
		"0000000014000000ff00010203040506" +
		"07ff08090a0b0c0d0e0fff1011121314" +
		"151617ff18191a1b1c1d1e1fff202122" +
		"2324252627ff1020300011213100ff12" +
		"22320013233300ff1424340015253500" +
		"ff1626360017273700ff182838001929" +
		"3900ff1a2a3a001b2b3b00ff1c2c3c00" +
		"1d2d3d00ff1e2e3e001f2f3f00ff2030" +
		"400021314100ff2232420023334300ff" +
		"2434440025354500ff26364600273747" +
		"00ff2838480029394900ff2a3a4a002b" +
		"3b4b00ff2c3c4c002d3d4d00ff2e3e4e" +
		"002f3f4f00ff3040500031415100ff32" +
		"42520033435300ff3444540035455500" +
		"ff3646560037475700ff384858003949" +
		"5900ff3a4a5a003b4b5b00ff3c4c5c00" +
		"3d4d5d00ff3e4e5e003f4f5f00ff4050" +
		"600041516100ff4252620043536300ff" +
		"4454640045556500ff46566600475767" +
		"00ff4858680049596900ff4a5a6a004b" +
		"5b6b00ff4c5c6c004d5d6d00ff4e5e6e" +
		"004f5f6f00ff5060700051617100ff52" +
		"62720053637300ff5464740055657500" +
		"ff5666760057677700ff586878005969" +
		"7900ff5a6a7a005b6b7b00ff5c6c7c00" +
		"5d6d7d00ff5e6e7e005f6f7f00ff6070" +
		"800061718100ff6272820063738300ff" +
		"6474840065758500ff66768600677787" +
		"00ff6878880069798900ff6a7a8a006b" +
		"7b8b00ff6c7c8c006d7d8d00ff6e7e8e" +
		"006f7f8f00ff7080900071819100ff72" +
		"82920073839300ff7484940075859500" +
		"ff7686960077879700ff788898007989" +
		"9900ff7a8a9a007b8b9b00ff7c8c9c00" +
		"7d8d9d00ff7e8e9e007f8f9f00ff8090" +
		"a0008191a100ff8292a2008393a300ff" +
		"8494a4008595a500ff8696a6008797a7" +
		"00ff8898a8008999a900ff8a9aaa008b" +
		"9bab00ff8c9cac008d9dad00ff8e9eae" +
		"008f9faf00ff90a0b00091a1b100ff92" +
		"a2b20093a3b300ff94a4b40095a5b500" +
		"ff96a6b60097a7b700ff98a8b80099a9" +
		"b900ff9aaaba009babbb00ff9cacbc00" +
		"9dadbd00ff9eaebe009fafbf00ffa0b0" +
		"c000a1b1c100ffa2b2c200a3b3c300ff" +
		"a4b4c400a5b5c500ffa6b6c600a7b7c7" +
		"00ffa8b8c800a9b9c900ffaabaca00ab" +
		"bbcb00ffacbccc00adbdcd00ffaebece" +
		"00afbfcf00ffb0c0d000b1c1d100ffb2" +
		"c2d200b3c3d300ffb4c4d400b5c5d500" +
		"ffb6c6d600b7c7d700ffb8c8d800b9c9" +
		"d900ffbacada00bbcbdb00ffbcccdc00" +
		"bdcddd00ffbecede00bfcfdf00ffc0d0" +
		"e000c1d1e100ffc2d2e200c3d3e300ff" +
		"c4d4e400c5d5e500ffc6d6e600c7d7e7" +
		"00ffc8d8e800c9d9e900ffcadaea00cb" +
		"dbeb00ffccdcec00cddded00ffcedeee" +
		"00cfdfef00ffd0e0f000d1e1f100ffd2" +
		"e2f200d3e3f300ffd4e4f400d5e5f500" +
		"ffd6e6f600d7e7f700ffd8e8f800d9e9" +
		"f900ffdaeafa00dbebfb00ffdcecfc00" +
		"ddedfd00ffdeeefe00dfefff00ffe0f0" +
		"0000e1f10100ffe2f20200e3f30300ff" +
		"e4f40400e5f50500ffe6f60600e7f707" +
		"00ffe8f80800e9f90900ffeafa0a00eb" +
		"fb0b00ffecfc0c00edfd0d00ffeefe0e" +
		"00efff0f00fff0001000f1011100fff2" +
		"021200f3031300fff4041400f5051500" +
		"fff6061600f7071700fff8081800f909" +
		"1900fffa0a1a00fb0b1b00fffc0c1c00" +
		"fd0d1d00fffe0e1e00ff0f1f00ff0010" +
		"200001112100ff0212220003132300ff" +
		"0414240005152500ff06162600071727" +
		"00ff0818280009192900ff0a1a2a000b" +
		"1b2b00ff0c1c2c000d1d2d00ff0e1e2e" +
		"000f1f2f00ff0102000003000000ff01" +
		"00010000000000ff0100000001000503" +
		"ff01000700",
	"hex",
);

describe("Studio Jikkenshitsu image format", () => {
	it("reads the head of a picture", () => {
		expect(readGrdLayout(ENCRYPTED, ENCRYPTED.length)).toEqual({
			bitsPerPixel: 24,
			width: 2,
			height: 1,
			stride: 6,
			encrypted: true,
			packedLength: 0x38,
			alphaLength: 0,
		});
		expect(readGrdLayout(GREY, GREY.length)).toMatchObject({
			bitsPerPixel: 8,
			width: 4,
			height: 2,
			stride: 4,
			encrypted: false,
		});
		expect(readGrdLayout(SHAPED, SHAPED.length)).toMatchObject({
			bitsPerPixel: 8,
			width: 2,
			height: 2,
			stride: 4,
			alphaLength: 20,
		});
	});

	it("stands the places of a key of the reference as a key of its own", () => {
		expect(grdKey().toString("hex")).toBe("f000000000000000");
	});

	it("turns away a file whose head does not hold its own words", () => {
		expect(readGrdLayout(grdFile({ word: "GRX " }), 0x18)).toBeUndefined();
		expect(readGrdLayout(Buffer.alloc(8), 8)).toBeUndefined();
		// The places of a colour of a picture stand beside eight and four and twenty.
		expect(readGrdLayout(grdFile({ bitsPerPixel: 16 }), 0x18)).toBeUndefined();
		expect(readGrdLayout(grdFile({ width: 0 }), 0x18)).toBeUndefined();
		expect(readGrdLayout(grdFile({ packedLength: 0 }), 0x18)).toBeUndefined();
		expect(
			readGrdLayout(
				grdFile({ packed: Buffer.alloc(4), packedLength: 0x100 }),
				0x1c,
			),
		).toBeUndefined();
	});

	it("stands the places of a picture under the cipher where the head names it", () => {
		const layout = readGrdLayout(ENCRYPTED, ENCRYPTED.length);
		if (!layout) throw new Error("the picture stands in the file");
		const bmp = decodeGrd(ENCRYPTED, layout);
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		// The places of the file stand the other way up, so the bitmap stands bottom up.
		expect(bmp.readInt32LE(0x16)).toBe(1);
		expect(bmp.subarray(0x36, 0x3c)).toEqual(
			Buffer.from("112233445566", "hex"),
		);
	});

	it("stands a picture of eight bits beside the colours that stand in it", () => {
		const layout = readGrdLayout(GREY, GREY.length);
		if (!layout) throw new Error("the picture stands in the file");
		const bmp = decodeGrd(GREY, layout);
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readUInt32LE(0x2e)).toBe(0x100);
		// The colours of the file stand as the blue, the green, the red and a place of nothing, and a bitmap
		// stands them as the red, the green and the blue.
		expect(bmp.subarray(0x36, 0x42)).toEqual(
			Buffer.from("0000000703010e0602150903", "hex"),
		);
		expect(bmp.subarray(0x436, 0x43e)).toEqual(
			Buffer.from("01020304fafbfcfd", "hex"),
		);
	});

	it("stands the shape of the places of a picture in the places of the picture", () => {
		const layout = readGrdLayout(SHAPED, SHAPED.length);
		if (!layout) throw new Error("the picture stands in the file");
		const bmp = decodeGrd(SHAPED, layout);
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		// The places of the shape stand the picture the right way up, its places counting places of a colour
		// of the shape as many places as they name.
		expect(bmp.readInt32LE(0x16)).toBe(-2);
		expect(bmp.subarray(0x36, 0x46)).toEqual(
			Buffer.from("132333ff15253533112131ff12223200", "hex"),
		);
	});

	it("hands out the places of a picture as a bitmap", async () => {
		const handle = await studioJikkenshitsuGrdImageFormat.open(
			new BufferByteSource(ENCRYPTED),
			"scene.grd",
		);
		expect(handle.entries.length).toBe(1);
		expect(handle.entries[0]?.path).toBe("scene.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			encrypted: true,
		});
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body.subarray(0x36, 0x3c)).toEqual(
			Buffer.from("112233445566", "hex"),
		);
	});

	it("finds a picture of its own kind", async () => {
		expect(studioJikkenshitsuGrdImageDescriptor.id).toBe(
			"studio-jikkenshitsu-grd-image",
		);
		await expect(
			studioJikkenshitsuGrdImageFormat.detect(new BufferByteSource(ENCRYPTED)),
		).resolves.toBe(true);
		await expect(
			studioJikkenshitsuGrdImageFormat.detect(
				new BufferByteSource(Buffer.from("not a picture at all")),
			),
		).resolves.toBe(false);
	});
});
