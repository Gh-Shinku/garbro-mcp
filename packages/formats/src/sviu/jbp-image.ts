import {
	JBP_HEADER_SIZE,
	decodeJbpPicture,
	jbpToBgr,
	readJbpHead,
} from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("JBP1", "latin1");
const BITS_PER_PLACE = 24;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface JbpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readJbpLayout(
	data: Buffer,
	fileLength = data.length,
): JbpLayout | undefined {
	if (fileLength < JBP_HEADER_SIZE || data.length < JBP_HEADER_SIZE) {
		return undefined;
	}
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const head = readJbpHead(data, 0);
	if (head.width === 0 || head.height === 0) return undefined;
	if (head.width * head.height > LIMIT) return undefined;
	if (head.dataPos < 0 || head.dataPos > fileLength) return undefined;
	if (head.places < 0 || head.otherPlaces < 0) return undefined;
	return {
		width: head.width,
		height: head.height,
		bitsPerPixel: BITS_PER_PLACE,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const sviuJbpImageDescriptor: FormatDescriptor = {
	id: "sviu-jbp-image",
	name: "SVIU System image format",
	extensions: ["jbp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Sviu/ImageJBP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sviuJbpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sviuJbpImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(JBP_HEADER_SIZE)) return false;
		try {
			const layout = readJbpLayout(
				await readStored(source),
				Number(source.size),
			);
			return layout !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readJbpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Purple picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readJbpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Purple picture");
		let picture: ReturnType<typeof decodeJbpPicture>;
		try {
			picture = decodeJbpPicture(stored, 0);
		} catch {
			throw invalidPicture(
				"Purple picture stands short of the places of its walk",
			);
		}
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp24(layout.width, layout.height, jbpToBgr(picture), false),
		]);
	},
});
