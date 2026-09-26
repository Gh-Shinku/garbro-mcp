// The counts of the walk of the counts of the Entis engine, of the reference
// `ArcFormats/Entis/EriReader.cs` (`ErisaProbModel`).
//
// The model stands of the places of the names of the walk of the engine (0x101 of them, the highest place
// of a count of the walk of a place of no name at all) and of the counts of the walks of every one of them.
// The places of the model stand of the counts of the walks of them, of the highest place of a count of the
// walk of the engine in front of the places of the count behind them: the walk of the engine stands of the
// place of a name of the model itself where the count of the walk of it stands past the count of the walk
// of the names of the model (`IncreaseSymbol`), of the counts of the model halved where the count of the
// walk of the model stands past the count of the walk of the engine (`HalfOccuredCount`).

/** The places of the model of the walk of the engine. */
const SYMBOL_SORT_MAX = 0x101;
const SUB_SORT_MAX = 0x80;
const SYMBOL_COUNT = 0x100;
const ESCAPE_CODE = -1;
/** The count of the walk of the model past which the counts of the model stand halved. */
export const ERISA_PROB_TOTAL_LIMIT = 0x2000;
export const ERISA_PROB_SYMBOL_MAX = SYMBOL_SORT_MAX;

/** A place of the model of the walk of the engine: the count of a name and the name of it. */
export interface ErisaProbSymbol {
	occured: number;
	symbol: number;
}

function placeOf(occured = 0, symbol = -1): ErisaProbSymbol {
	return { occured, symbol };
}

/** `ErisaProbModel`: the counts of the walks of the names of the walk of the engine. */
export class ErisaProbModel {
	totalCount: number;
	symbolSorts: number;
	symTable: ErisaProbSymbol[];
	subModel: ErisaProbSymbol[];

	constructor() {
		this.totalCount = 0;
		this.symbolSorts = 0;
		this.symTable = [];
		this.subModel = [];
		this.initialize();
	}

	/** `Initialize`: the model of every name of the walk of the engine, one count apiece. */
	initialize(): void {
		this.totalCount = SYMBOL_SORT_MAX;
		this.symbolSorts = SYMBOL_SORT_MAX;
		this.symTable = [];
		for (let at = 0; at < SYMBOL_COUNT; at += 1) {
			this.symTable.push(placeOf(1, at));
		}
		this.symTable.push(placeOf(1, ESCAPE_CODE));
		this.subModel = [];
		for (let at = 0; at < SUB_SORT_MAX; at += 1) {
			this.subModel.push(placeOf(0, -1));
		}
	}

	/** `AccumulateProb`: the count of the places of the walk of a name of the model. */
	accumulateProb(symbol: number): number {
		const index = this.findSymbol(symbol);
		if (index < 0) return 0;
		let occured = this.symTable[index]?.occured ?? 0;
		let count = 0;
		while (occured < this.totalCount) {
			occured <<= 1;
			count += 1;
		}
		return count;
	}

	/** `HalfOccuredCount`: the counts of the model halved, of the count of the walk of it behind them. */
	halfOccuredCount(): void {
		this.totalCount = 0;
		for (let at = 0; at < this.symbolSorts; at += 1) {
			const place = this.symTable[at];
			if (!place) continue;
			place.occured = ((place.occured + 1) >> 1) & 0xffff;
			this.totalCount += place.occured;
		}
		for (const place of this.subModel) {
			place.occured = (place.occured >> 1) & 0xffff;
		}
	}

	/** `IncreaseSymbol`: the count of the walk of a name of the model, of the walk of the model behind it. */
	increaseSymbol(index: number): number {
		const place = this.symTable[index];
		if (!place) return index;
		const occured = (place.occured + 1) & 0xffff;
		place.occured = occured;
		const symbol = place.symbol;
		let at = index - 1;
		while (at >= 0) {
			const before = this.symTable[at];
			if (!before || before.occured >= occured) break;
			const next = this.symTable[at + 1];
			if (next) {
				next.occured = before.occured;
				next.symbol = before.symbol;
			}
			at -= 1;
		}
		at += 1;
		const target = this.symTable[at];
		if (target) {
			target.occured = occured;
			target.symbol = symbol;
		}
		this.totalCount += 1;
		if (this.totalCount >= ERISA_PROB_TOTAL_LIMIT) {
			this.halfOccuredCount();
		}
		return at;
	}

	/** `FindSymbol`: the place of a name of the walk of the model. */
	findSymbol(symbol: number): number {
		for (let at = 0; at < this.symbolSorts; at += 1) {
			if (this.symTable[at]?.symbol === symbol) return at;
		}
		return -1;
	}

	/** `AddSymbol`: the places of a name of the walk of the model, of no count of it at all. */
	addSymbol(symbol: number): number {
		const at = this.symbolSorts;
		this.symbolSorts += 1;
		this.totalCount += 1;
		const place = this.symTable[at];
		if (place) {
			place.symbol = symbol;
			place.occured = 1;
		} else {
			this.symTable[at] = placeOf(1, symbol);
		}
		return at;
	}

	/** Whether the model stands within the counts of the walk of the engine. */
	get withinLimit(): boolean {
		return this.totalCount <= ERISA_PROB_TOTAL_LIMIT;
	}
}
