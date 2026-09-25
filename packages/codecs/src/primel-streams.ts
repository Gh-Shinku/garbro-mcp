// Port of three of the four packed streams of the Primel engine: `GameRes.Formats.Primel.LzssPackedStream`,
// `RlePackedStream` and `MtfPackedStream` (source `ArcFormats/Primel/Compression.cs`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The engine packs the payload of an entry with one of four streams, of which the flags of the entry's head
// name one. Two of the three here read the count of the places they turn out from the head of the stream: the
// walk of `LzssPackedStream` over a window of `2 << word` places, which reads a run as a distance of two
// places and a count of one, and the walk of `RlePackedStream`, which reads a place that stands where the one
// in front of it stands as a run. The third, `MtfPackedStream`, reads the places of the stream over the table
// of the places of a byte, carrying every place it reads to the front of that table, and then turns the run
// out over a table of its own.
//
// The fourth stream, `RangePackedStream`, is a range decoder of its own and stands as a later stage of the
// port.
//
// The walks of the reference turn their places out as they go and stop where their input stops: a stream that
// stands short of the count its head names hands over a shorter run of places rather than throwing, and these
// ports do the same, of one difference - a head that stands past the places of the stream is turned away here
// rather than read as nothing. The walk of `MtfPackedStream` never stops on its own - the reference says so
// in a comment of its own - so its count of places is handed to it here.

const WORD_PLACES = 4;
/** The window of the walk of `LzssPackedStream`: two places to the power of the word of the head. */
const FRAME_BASE = 2;
/** The places of a run of the walk of `LzssPackedStream`, behind the place of the count. */
const LZSS_RUN_BASE = 4;
/** The places of a run of the walk of `RlePackedStream`, behind the place of the count. */
const RLE_RUN_BASE = 2;
/** The places a byte stands of. */
const TABLE_PLACES = 256;

/** A reader of the stream of a walk, of the place it stands at. */
class StreamReader {
	private at = 0;

	constructor(private readonly data: Buffer) {}

	/** The next place of the stream, or -1 where the stream stops. */
	byte(): number {
		if (this.at >= this.data.length) return -1;
		const place = this.data[this.at] ?? 0;
		this.at += 1;
		return place;
	}

	/** The places of a word of the head, from the lowest place of a byte up. */
	private wordPlaces(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			const place = this.byte();
			if (place < 0) {
				throw new RangeError("The stream of the walk stands short of its head");
			}
			value |= place << (index * 8);
		}
		return value >>> 0;
	}

	/** `ArcView.Reader.ReadInt32`. */
	int32(): number {
		return this.wordPlaces(WORD_PLACES) | 0;
	}

	/** `ArcView.Reader.ReadUInt16`. */
	uint16(): number {
		return this.wordPlaces(2);
	}
}

/**
 * `LzssPackedStream.Unpack`: the count of the places of the stream and the window of the walk, then the
 * places themselves, of a place of a picture as it stands where the lowest place of the control byte stands
 * and of a run of the distance of two places and the count of one everywhere else.
 */
export function unpackPrimelLzss(input: Buffer): Buffer {
	const reader = new StreamReader(input);
	const unpackedSize = reader.int32();
	const frameSize = FRAME_BASE << reader.uint16();
	const frame = Buffer.alloc(frameSize, 0x00);
	const out: number[] = [];
	let frameAt = 0;
	let control = 2;
	while (out.length < unpackedSize) {
		control >>= 1;
		if (1 === control) {
			const place = reader.byte();
			if (place < 0) break;
			control = place | 0x100;
		}
		const place = reader.byte();
		if (place < 0) break;
		if (0 !== (control & 1)) {
			out.push(place);
			frame[frameAt % frame.length] = place;
			frameAt += 1;
			continue;
		}
		const high = reader.byte();
		const count = reader.byte();
		if (high < 0 || count < 0) break;
		const distance = place | (high << 8);
		// The run reaches back from the place the walk stands at, which the places of the run then move on.
		let from = (frameAt - distance) % frame.length;
		if (from < 0) from += frame.length;
		for (let done = 0; done < count + LZSS_RUN_BASE; done += 1) {
			const value = frame[from % frame.length] ?? 0;
			out.push(value);
			frame[frameAt % frame.length] = value;
			frameAt += 1;
			from += 1;
		}
	}
	return Buffer.from(out);
}

/**
 * `RlePackedStream.Unpack`: the count of the places of the stream, then the places of it, where a place that
 * stands where the place in front of it stands is read as the count behind it of places of its own.
 */
export function unpackPrimelRle(input: Buffer): Buffer {
	const reader = new StreamReader(input);
	const unpackedSize = reader.int32();
	const out: number[] = [];
	let previous = reader.byte();
	while (out.length + 1 < unpackedSize) {
		let place = reader.byte();
		if (place < 0) break;
		if (place === previous) {
			const count = reader.byte();
			if (count < 0) break;
			for (let done = 0; done < count + RLE_RUN_BASE; done += 1)
				out.push(place);
			place = reader.byte();
		} else {
			out.push(previous);
		}
		previous = place;
	}
	if (out.length < unpackedSize && previous >= 0) out.push(previous);
	return Buffer.from(out);
}

/**
 * `MtfPackedStream.Unpack`: the place of the table the walk of the run begins at, then the places of the
 * stream, every one of them the place it names of the table of the places of a byte, carried to the front of
 * that table behind it. The places the walk turns out stand of a second table: the place of every one of them
 * within the run, of the count of the places of the run that stand in front of it and of its own place behind
 * that, of a walk of that table from the place the head names.
 *
 * `count` is the count of places to turn out; the walk of the reference never stops on its own.
 */
export function unpackPrimelMtf(input: Buffer, count: number): Buffer {
	const reader = new StreamReader(input);
	const start = reader.int32();
	const table = new Uint8Array(TABLE_PLACES);
	for (let index = 0; index < table.length; index += 1) table[index] = index;
	const places: number[] = [];
	for (;;) {
		const at = reader.byte();
		if (at < 0) break;
		const place = table[at] ?? 0;
		let front = table[0] ?? 0;
		if (front !== place) {
			// Every place in front of the one that was read stands one place behind it afterwards.
			for (let index = 1; ; index += 1) {
				const swap = table[index] ?? 0;
				table[index] = front;
				front = swap;
				if (swap === place) break;
			}
			table[0] = place;
		}
		places.push(place);
	}
	// The table of the run: the place of every place of the stream within a stable count of the places of the
	// stream by their own place.
	const offsets = new Uint32Array(TABLE_PLACES);
	for (const place of places) offsets[place] = (offsets[place] ?? 0) + 1;
	let remaining = places.length;
	for (let index = TABLE_PLACES - 1; index >= 0; index -= 1) {
		remaining -= offsets[index] ?? 0;
		offsets[index] = remaining;
	}
	const order = new Uint32Array(places.length);
	for (let index = 0; index < places.length; index += 1) {
		const place = places[index] ?? 0;
		const at = offsets[place] ?? 0;
		order[at] = index;
		offsets[place] = at + 1;
	}
	const out = Buffer.alloc(count);
	let index = start;
	for (let at = 0; at < count; at += 1) {
		if (index < 0 || index >= order.length) {
			throw new RangeError(
				"The walk of the places of the stream stands past them",
			);
		}
		index = order[index] ?? 0;
		out[at] = places[index] ?? 0;
	}
	return out;
}
