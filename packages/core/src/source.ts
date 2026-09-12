import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { GarbroError } from "./errors.js";

const DEFAULT_CHUNK_SIZE = 256 * 1024;

export interface ByteSource {
	readonly path?: string;
	readonly size: bigint;
	readAt(offset: bigint, length: number): Promise<Buffer>;
	createReadStream(offset: bigint, length: bigint): Readable;
	close(): Promise<void>;
}

function validateRange(size: bigint, offset: bigint, length: bigint): void {
	if (offset < 0n || length < 0n || offset > size || length > size - offset) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Read range is outside the source",
			{
				details: {
					offset: offset.toString(),
					length: length.toString(),
					size: size.toString(),
				},
			},
		);
	}
}

export class FileByteSource implements ByteSource {
	readonly path: string;
	readonly size: bigint;
	readonly #handle: FileHandle;
	#closed = false;

	private constructor(path: string, handle: FileHandle, size: bigint) {
		this.path = path;
		this.#handle = handle;
		this.size = size;
	}

	static async open(path: string): Promise<FileByteSource> {
		const handle = await open(path, "r");
		try {
			const stats = await handle.stat({ bigint: true });
			if (!stats.isFile()) {
				throw new GarbroError("IO_ERROR", `Not a regular file: ${path}`);
			}
			return new FileByteSource(path, handle, stats.size);
		} catch (error) {
			await handle.close();
			throw error;
		}
	}

	async readAt(offset: bigint, length: number): Promise<Buffer> {
		this.#assertOpen();
		if (!Number.isSafeInteger(length) || length < 0) {
			throw new RangeError("length must be a non-negative safe integer");
		}
		validateRange(this.size, offset, BigInt(length));
		const buffer = Buffer.allocUnsafe(length);
		let total = 0;
		while (total < length) {
			const { bytesRead } = await this.#handle.read(
				buffer,
				total,
				length - total,
				offset + BigInt(total),
			);
			if (bytesRead === 0) {
				throw new GarbroError("INVALID_ARCHIVE", "Unexpected end of file");
			}
			total += bytesRead;
		}
		return buffer;
	}

	createReadStream(offset: bigint, length: bigint): Readable {
		this.#assertOpen();
		validateRange(this.size, offset, length);
		const source = this;
		return Readable.from(
			(async function* () {
				let position = offset;
				let remaining = length;
				while (remaining > 0n) {
					const chunkLength = Number(
						remaining > BigInt(DEFAULT_CHUNK_SIZE)
							? BigInt(DEFAULT_CHUNK_SIZE)
							: remaining,
					);
					yield await source.readAt(position, chunkLength);
					position += BigInt(chunkLength);
					remaining -= BigInt(chunkLength);
				}
			})(),
		);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		await this.#handle.close();
	}

	#assertOpen(): void {
		if (this.#closed) throw new GarbroError("IO_ERROR", "Source is closed");
	}
}

export class BufferByteSource implements ByteSource {
	readonly size: bigint;
	readonly #buffer: Buffer;

	constructor(buffer: Uint8Array) {
		this.#buffer = Buffer.from(buffer);
		this.size = BigInt(buffer.byteLength);
	}

	async readAt(offset: bigint, length: number): Promise<Buffer> {
		validateRange(this.size, offset, BigInt(length));
		const start = Number(offset);
		return Buffer.from(this.#buffer.subarray(start, start + length));
	}

	createReadStream(offset: bigint, length: bigint): Readable {
		validateRange(this.size, offset, length);
		const start = Number(offset);
		return Readable.from([
			this.#buffer.subarray(start, start + Number(length)),
		]);
	}

	async close(): Promise<void> {}
}
