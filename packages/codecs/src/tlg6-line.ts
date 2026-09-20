export const TLG6_LINE_FILTERS: readonly [
	boolean,
	readonly [number, number, number],
	readonly [number, number, number],
	readonly [number, number, number],
][] = [
	[false, [1, 0, 0], [0, 1, 0], [0, 0, 1]],
	[true, [1, 0, 0], [0, 1, 0], [0, 0, 1]],
	[false, [1, 1, 0], [0, 1, 0], [0, 1, 1]],
	[true, [1, 1, 0], [0, 1, 0], [0, 1, 1]],
	[false, [1, 1, 1], [0, 1, 1], [0, 0, 1]],
	[true, [1, 1, 1], [0, 1, 1], [0, 0, 1]],
	[false, [1, 0, 0], [1, 1, 0], [1, 1, 1]],
	[true, [1, 0, 0], [1, 1, 0], [1, 1, 1]],
	[false, [2, 1, 1], [1, 1, 1], [1, 0, 1]],
	[true, [2, 1, 1], [1, 1, 1], [1, 0, 1]],
	[false, [1, 0, 0], [1, 1, 1], [1, 0, 1]],
	[true, [1, 0, 0], [1, 1, 1], [1, 0, 1]],
	[false, [1, 0, 0], [0, 1, 0], [0, 1, 1]],
	[true, [1, 0, 0], [0, 1, 0], [0, 1, 1]],
	[false, [1, 0, 0], [0, 1, 1], [0, 0, 1]],
	[true, [1, 0, 0], [0, 1, 1], [0, 0, 1]],
	[false, [1, 1, 0], [0, 1, 0], [0, 0, 1]],
	[true, [1, 1, 0], [0, 1, 0], [0, 0, 1]],
	[false, [1, 0, 1], [1, 1, 1], [1, 1, 2]],
	[true, [1, 0, 1], [1, 1, 1], [1, 1, 2]],
	[false, [1, 0, 0], [1, 1, 0], [1, 0, 1]],
	[true, [1, 0, 0], [1, 1, 0], [1, 0, 1]],
	[false, [1, 0, 1], [0, 1, 1], [0, 0, 1]],
	[true, [1, 0, 1], [0, 1, 1], [0, 0, 1]],
	[false, [1, 0, 1], [1, 1, 1], [0, 0, 1]],
	[true, [1, 0, 1], [1, 1, 1], [0, 0, 1]],
	[false, [1, 1, 1], [1, 2, 1], [0, 1, 1]],
	[true, [1, 1, 1], [1, 2, 1], [0, 1, 1]],
	[false, [2, 1, 1], [1, 1, 0], [1, 1, 1]],
	[true, [2, 1, 1], [1, 1, 0], [1, 1, 1]],
	[false, [1, 0, 2], [0, 1, 2], [0, 0, 1]],
	[true, [1, 0, 2], [0, 1, 2], [0, 0, 1]],
];

export function tlg6MakeGtMask(a: number, b: number): number {
	const notB = ~b;
	const tmp = ((a & notB) + (((a ^ notB) >>> 1) & 0x7f7f7f7f)) & 0x80808080;
	return (((tmp >>> 7) + 0x7f7f7f7f) ^ 0x7f7f7f7f) >>> 0;
}

export function tlg6Med2(a: number, b: number, c: number): number {
	const aGtB = tlg6MakeGtMask(a, b);
	const mixed = (a ^ b) & aGtB;
	const aa = mixed ^ a;
	const bb = mixed ^ b;
	const n = tlg6MakeGtMask(c, bb);
	const nn = tlg6MakeGtMask(aa, c);
	const m = ~(n | nn);
	return ((n & aa) | (nn & bb) | (((bb & m) - (c & m) + (aa & m)) >>> 0)) >>> 0;
}

export function tlg6PackedBytesAdd(a: number, b: number): number {
	const tmp = ((((a & b) << 1) + ((a ^ b) & 0xfefefefe)) & 0x01010100) >>> 0;
	return (a + b - tmp) >>> 0;
}

export function tlg6Med(a: number, b: number, c: number, v: number): number {
	return tlg6PackedBytesAdd(tlg6Med2(a, b, c), v);
}

export function tlg6Avg(a: number, b: number, _c: number, v: number): number {
	const mean =
		((a & b) + (((a ^ b) & 0xfefefefe) >>> 1) + ((a ^ b) & 0x01010101)) >>> 0;
	return tlg6PackedBytesAdd(mean, v);
}

export function applyTlg6Filter(
	filterType: number,
	a: number,
	b: number,
	c: number,
	v: number,
): number {
	const filter = TLG6_LINE_FILTERS[filterType];
	if (filter === undefined)
		throw new RangeError(
			"The places of the picture of the walk of the places of the picture of the place of the picture of the walk of them stand past the places of the picture of the walk of the places of the picture",
		);
	const [usesAverage, rowR, rowG, rowB] = filter;
	const r = (v >>> 16) & 0xff;
	const g = (v >>> 8) & 0xff;
	const bl = v & 0xff;
	const placed =
		(((((rowR[0] * r + rowR[1] * g + rowR[2] * bl) & 0xff) << 16) |
			(((rowG[0] * r + rowG[1] * g + rowG[2] * bl) & 0xff) << 8) |
			((rowB[0] * r + rowB[1] * g + rowB[2] * bl) & 0xff)) +
			(v & 0xff000000)) >>>
		0;
	return usesAverage ? tlg6Avg(a, b, c, placed) : tlg6Med(a, b, c, placed);
}

export function applyTlg6Line(
	prevLine: Uint32Array,
	prevAt: number,
	curLine: Uint32Array,
	curAt: number,
	width: number,
	startBlock: number,
	blockLimit: number,
	filterTypes: Uint8Array,
	filterAt: number,
	skipBlockBytes: number,
	input: Uint32Array,
	inputAt: number,
	initialP: number,
	oddSkip: number,
	dir: number,
): void {
	let p: number;
	let up: number;
	if (startBlock !== 0) {
		prevAt += startBlock * 8;
		curAt += startBlock * 8;
		p = curLine[curAt - 1] ?? 0;
		up = prevLine[prevAt - 1] ?? 0;
	} else {
		p = initialP;
		up = initialP;
	}
	inputAt += skipBlockBytes * startBlock;
	const step = (dir & 1) !== 0 ? 1 : -1;
	for (let i = startBlock; i < blockLimit; i += 1) {
		let w = width - i * 8;
		if (w > 8) w = 8;
		const ww = w;
		if (step === -1) inputAt += ww - 1;
		if ((i & 1) !== 0) inputAt += oddSkip * ww;
		const filterType = filterTypes[filterAt + i] ?? 0;
		if (filterType > 31)
			throw new RangeError(
				"The places of the picture of the walk of the places of the picture of the place of the picture of the walk of them stand past the places of the picture of the walk of the places of the picture",
			);
		for (let at = 0; at < ww; at += 1) {
			const u = prevLine[prevAt] ?? 0;
			p = applyTlg6Filter(filterType, p, u, up, input[inputAt] ?? 0);
			up = u;
			curLine[curAt] = p;
			curAt += 1;
			prevAt += 1;
			inputAt += step;
		}
		if (step === 1) inputAt += skipBlockBytes - ww;
		else inputAt += skipBlockBytes + 1;
		if ((i & 1) !== 0) inputAt -= oddSkip * ww;
	}
}
