import iconv from "iconv-lite";

export type BinaryStringEncoding = "ascii" | "utf8" | "utf16le" | "cp932";
export type CStringEncoding = Exclude<BinaryStringEncoding, "utf16le">;

export function decodeBinaryString(
	value: Uint8Array,
	encoding: BinaryStringEncoding,
): string {
	const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	if (encoding === "cp932") return iconv.decode(buffer, "cp932");
	return buffer.toString(encoding);
}

export function encodeCp932(value: string): Buffer {
	return iconv.encode(value, "cp932");
}

export function decodeCp932(value: Uint8Array): string {
	return decodeBinaryString(value, "cp932");
}
