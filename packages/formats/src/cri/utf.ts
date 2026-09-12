import { BufferCursor, GarbroError } from "@garbro-mcp/core";

export type UtfValue = number | bigint | string | Buffer;
export type UtfRow = Record<string, UtfValue>;

const STORAGE_MASK = 0xf0;
const STORAGE_NONE = 0x00;
const STORAGE_ZERO = 0x10;
const STORAGE_CONSTANT = 0x30;
const STORAGE_PER_ROW = 0x50;
const TYPE_MASK = 0x0f;

interface UtfColumn {
	name: string;
	flags: number;
	constant?: UtfValue;
}

function readCString(buffer: Buffer, offset: number): string {
	if (!Number.isSafeInteger(offset) || offset < 0 || offset >= buffer.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"CRI UTF string offset is invalid",
		);
	}
	const end = buffer.indexOf(0, offset);
	if (end === -1) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"CRI UTF string is not terminated",
		);
	}
	return buffer.subarray(offset, end).toString("utf8");
}

function readValue(
	cursor: BufferCursor,
	type: number,
	chunk: Buffer,
	stringsOffset: number,
	dataOffset: number,
): UtfValue {
	switch (type) {
		case 0x00:
			return cursor.readU8();
		case 0x01: {
			const value = cursor.readU8();
			return value >= 0x80 ? value - 0x100 : value;
		}
		case 0x02:
			return cursor.readU16BE();
		case 0x03:
			return cursor.readI16BE();
		case 0x04:
			return cursor.readU32BE();
		case 0x05:
			return cursor.readI32BE();
		case 0x06:
			return cursor.readU64BE();
		case 0x07:
			return cursor.readI64BE();
		case 0x08:
			return cursor.readBytes(4).readFloatBE(0);
		case 0x09:
			return cursor.readBytes(8).readDoubleBE(0);
		case 0x0a:
			return readCString(chunk, stringsOffset + cursor.readU32BE());
		case 0x0b: {
			const offset = dataOffset + cursor.readU32BE();
			const length = cursor.readU32BE();
			if (
				offset < dataOffset ||
				offset > chunk.length ||
				length > chunk.length - offset
			) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"CRI UTF data value is invalid",
				);
			}
			return Buffer.from(chunk.subarray(offset, offset + length));
		}
		default:
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported CRI UTF value type: ${type}`,
			);
	}
}

export function decryptUtfChunk(chunk: Buffer): void {
	let key = 0x655f;
	for (let index = 0; index < chunk.length; index += 1) {
		chunk[index] = (chunk[index] ?? 0) ^ (key & 0xff);
		key = Math.imul(key, 0x4115);
	}
}

export function parseUtfTable(input: Uint8Array): UtfRow[] {
	const chunk = Buffer.from(input);
	if (!chunk.subarray(0, 4).equals(Buffer.from("@UTF"))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid CRI UTF signature");
	}
	if (chunk.length < 32) {
		throw new GarbroError("INVALID_ARCHIVE", "CRI UTF table is truncated");
	}
	const chunkLength = chunk.readUInt32BE(4);
	if (chunkLength > chunk.length - 8) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"CRI UTF length exceeds its chunk",
		);
	}
	const body = new BufferCursor(chunk.subarray(8, 8 + chunkLength));
	const rowsOffset = body.readU32BE();
	const stringsOffset = body.readU32BE() + 8;
	const dataOffset = body.readU32BE() + 8;
	body.skip(4);
	const columnCount = body.readU16BE();
	const rowLength = body.readU16BE();
	const rowCount = body.readU32BE();
	if (
		stringsOffset < 8 ||
		stringsOffset > chunk.length ||
		dataOffset < stringsOffset ||
		dataOffset > chunk.length
	) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"CRI UTF section offsets are invalid",
		);
	}

	const columns: UtfColumn[] = [];
	for (let index = 0; index < columnCount; index += 1) {
		let flags = body.readU8();
		if (flags === 0) {
			body.skip(3);
			flags = body.readU8();
		}
		const name = readCString(chunk, stringsOffset + body.readU32BE());
		const column: UtfColumn = { name, flags };
		if ((flags & STORAGE_MASK) === STORAGE_CONSTANT) {
			column.constant = readValue(
				body,
				flags & TYPE_MASK,
				chunk,
				stringsOffset,
				dataOffset,
			);
		}
		columns.push(column);
	}

	if (
		rowsOffset > chunkLength ||
		rowCount > Math.floor((chunkLength - rowsOffset) / Math.max(rowLength, 1))
	) {
		throw new GarbroError("INVALID_ARCHIVE", "CRI UTF rows are truncated");
	}
	const rows: UtfRow[] = [];
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
		body.seek(rowsOffset + rowIndex * rowLength);
		const row: UtfRow = {};
		for (const column of columns) {
			const storage = column.flags & STORAGE_MASK;
			if (storage === STORAGE_NONE) continue;
			if (storage === STORAGE_ZERO) {
				row[column.name] = 0;
				continue;
			}
			if (storage === STORAGE_CONSTANT) {
				if (column.constant !== undefined) row[column.name] = column.constant;
				continue;
			}
			if (storage !== STORAGE_PER_ROW) {
				throw new GarbroError(
					"UNSUPPORTED_FEATURE",
					`Unsupported CRI UTF storage mode: 0x${storage.toString(16)}`,
				);
			}
			row[column.name] = readValue(
				body,
				column.flags & TYPE_MASK,
				chunk,
				stringsOffset,
				dataOffset,
			);
		}
		rows.push(row);
	}
	return rows;
}
