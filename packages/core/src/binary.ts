import { GarbroError } from "./errors.js";

export class BufferCursor {
	readonly #buffer: Buffer;
	#position = 0;

	constructor(buffer: Uint8Array) {
		this.#buffer = Buffer.from(
			buffer.buffer,
			buffer.byteOffset,
			buffer.byteLength,
		);
	}

	get position(): number {
		return this.#position;
	}

	get remaining(): number {
		return this.#buffer.length - this.#position;
	}

	seek(position: number): void {
		if (
			!Number.isSafeInteger(position) ||
			position < 0 ||
			position > this.#buffer.length
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid binary cursor position",
			);
		}
		this.#position = position;
	}

	skip(length: number): void {
		this.#ensure(length);
		this.#position += length;
	}

	readBytes(length: number): Buffer {
		this.#ensure(length);
		const value = this.#buffer.subarray(
			this.#position,
			this.#position + length,
		);
		this.#position += length;
		return value;
	}

	readTag(): string {
		return this.readBytes(4).toString("ascii");
	}

	readU8(): number {
		this.#ensure(1);
		return this.#buffer[this.#position++] ?? 0;
	}

	readU16LE(): number {
		this.#ensure(2);
		const value = this.#buffer.readUInt16LE(this.#position);
		this.#position += 2;
		return value;
	}

	readI16LE(): number {
		this.#ensure(2);
		const value = this.#buffer.readInt16LE(this.#position);
		this.#position += 2;
		return value;
	}

	readU32LE(): number {
		this.#ensure(4);
		const value = this.#buffer.readUInt32LE(this.#position);
		this.#position += 4;
		return value;
	}

	readI32LE(): number {
		this.#ensure(4);
		const value = this.#buffer.readInt32LE(this.#position);
		this.#position += 4;
		return value;
	}

	readU64LE(): bigint {
		this.#ensure(8);
		const value = this.#buffer.readBigUInt64LE(this.#position);
		this.#position += 8;
		return value;
	}

	readI64LE(): bigint {
		this.#ensure(8);
		const value = this.#buffer.readBigInt64LE(this.#position);
		this.#position += 8;
		return value;
	}

	readUtf16Le(codeUnits: number): string {
		if (!Number.isSafeInteger(codeUnits) || codeUnits < 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid UTF-16 string length");
		}
		return this.readBytes(codeUnits * 2).toString("utf16le");
	}

	#ensure(length: number): void {
		if (
			!Number.isSafeInteger(length) ||
			length < 0 ||
			length > this.remaining
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Unexpected end of binary data",
				{
					details: {
						position: this.#position,
						length,
						remaining: this.remaining,
					},
				},
			);
		}
	}
}

export function bigintToBufferLength(value: bigint, label: string): number {
	if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new GarbroError("INVALID_ARCHIVE", `${label} is too large`, {
			details: { value: value.toString() },
		});
	}
	const result = Number(value);
	if (result > 0x7fffffff) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`${label} exceeds the in-memory limit`,
			{
				details: { value: value.toString() },
			},
		);
	}
	return result;
}
