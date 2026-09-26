// The counts of the walk of the engine of the `Nemesis` of the Entis engine ("ArcFormats/Entis/
// ErisaNemesis.cs", classes `NemesisDecodeContext`, `ErisaProbBase`, `NemesisPhraseLookup` and the counts
// of the walk of the places of the count of the walk of the engine of their own). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The walk stands of the places of the count of the walk of the engine of the counts of the model of the
// walk of the engine (`ErisaProbModel`), of the counts of the walk of the engine of the places of the count
// of the walk of the engine of the count of the walk of the picture itself (the phrases of the places of the
// walk of the engine) and of the counts of the walk of the engine of the places of the count of the walk of
// the engine behind them.

import { GarbroError } from "@garbro-mcp/core";
import { ErisaProbDecodeContext } from "./erisa-context.js";
import { ErisaProbModel } from "./erisa-prob-model.js";

/** The counts of the walk of the engine of the places of the count of the walk of the engine of the engine. */
export const NEMESIS_BUF_SIZE = 0x10000;
export const NEMESIS_BUF_MASK = 0xffff;
export const NEMESIS_INDEX_LIMIT = 0x100;
export const NEMESIS_INDEX_MASK = 0xff;
/** The counts of the places of the count of the walk of the engine of the engine (`ErisaProbBase`). */
export const ERISA_PROB_SLOT_MAX = 0x800;
export const ERISA_PROB_SHIFT_COUNT = [1, 3, 4, 5];
export const ERISA_PROB_NEW_LIMIT = [0x01, 0x08, 0x10, 0x20];
const MAX_DEGREE = 4;
const ERISA_ESCAPE_CODE = -1;

function invalidNemesis(): GarbroError {
	return new GarbroError(
		"INVALID_ARCHIVE",
		"Invalid Nemesis encoding sequence",
	);
}

/** `NemesisPhraseLookup`: the places of a count of the walk of the engine of the places of its own. */
export class NemesisPhraseLookup {
	first = 0;
	index = new Uint32Array(NEMESIS_INDEX_LIMIT);
}

/** `ErisaProbBase`: the models of the counts of the walk of the engine of a count of the walk of it. */
export class ErisaProbBase {
	workUsed = 0;
	baseModel = new ErisaProbModel();
	probIndex: ErisaProbModel[] = [];

	// The reference stands of the counts of the walk of the engine of the models of the walk of the engine
	// of the places of the count of the walk of the engine of its own: this port stands of the counts of the
	// walk of the engine of a model where the counts of the walk of the engine stand of the places of the
	// count of the walk of the engine of the count of the walk of the engine of it itself.
}

/**
 * `NemesisDecodeContext`: the counts of the walk of the engine of the kind `Nemesis` of the engine. The walk
 * stands of the counts of the model of the walk of the engine of the places of the count of the walk of the
 * engine of the count of the walk of the picture of its own (`ErisaProbModel`), of the places of the count
 * of the walk of the engine of the count of the walk of the picture itself and of the counts of the walk of
 * the engine of the places of the count of the walk of the engine behind them.
 */
export class ErisaNemesisDecodeContext extends ErisaProbDecodeContext {
	#buf = new Uint8Array(NEMESIS_BUF_SIZE);
	#lookup: NemesisPhraseLookup[] = [];
	#lastSymbol = new Uint8Array(MAX_DEGREE);
	#lastSymbolAt = 0;
	#nemesisIndex = 0;
	#nemesisLeft = 0;
	#nemesisNext = 0;
	#flagEof = false;
	#prob: ErisaProbBase;

	constructor(bufferingSize = NEMESIS_BUF_SIZE) {
		super(bufferingSize);
		this.#prob = new ErisaProbBase();
	}

	/** The counts of the model of the walk of the engine of the places of the count of the walk of it. */
	get workUsed(): number {
		return this.#prob.workUsed;
	}

	/** `PrepareToDecodeERISANCode`: the models of the counts of the walk of the engine. */
	prepareToDecodeErisaNCode(): void {
		this.#lastSymbolAt = 0;
		this.#lastSymbol.fill(0);
		const prob = this.#prob;
		prob.workUsed = 0;
		prob.baseModel.initialize();
		for (const model of prob.probIndex) model.initialize();
		this.prepareToDecodeErisaCode();
		this.#buf.fill(0);
		this.#lookup = [];
		for (let at = 0; at < NEMESIS_INDEX_LIMIT; at += 1) {
			this.#lookup.push(new NemesisPhraseLookup());
		}
		this.#nemesisIndex = 0;
		this.#nemesisLeft = 0;
		this.#flagEof = false;
	}

	override decodeBytes(places: Uint8Array, count: number): number {
		return this.decodeNemesisCodeBytes(places, 0, count);
	}

	/** `DecodeNemesisCodeBytes`: the places of the count of the walk of the engine, of the count of it. */
	decodeNemesisCodeBytes(
		places: Uint8Array,
		dst: number,
		count: number,
	): number {
		if (this.#flagEof) return 0;
		const prob = this.#prob;
		let decoded = 0;
		let at = dst;
		while (decoded < count) {
			if (this.#nemesisLeft > 0) {
				// The counts of the walk of the engine of the places of the count of the walk of the engine
				// of the count of the walk of the picture itself stand of the places of the count of the
				// walk of the engine behind them.
				let left = this.#nemesisLeft;
				if (left > count - decoded) left = count - decoded;
				let last = this.#buf[(this.#nemesisIndex - 1) & NEMESIS_BUF_MASK] ?? 0;
				for (let place = 0; place < left; place += 1) {
					let symbol = last;
					if (this.#nemesisNext >= 0) {
						symbol = this.#buf[this.#nemesisNext] ?? 0;
						this.#nemesisNext = (this.#nemesisNext + 1) & NEMESIS_BUF_MASK;
					}
					this.#lastSymbol[this.#lastSymbolAt] = symbol;
					this.#lastSymbolAt = (this.#lastSymbolAt + 1) & (MAX_DEGREE - 1);
					const phrase = this.#lookup[symbol];
					if (phrase) {
						phrase.index[phrase.first] = this.#nemesisIndex;
						phrase.first = (phrase.first + 1) & NEMESIS_INDEX_MASK;
					}
					last = symbol;
					this.#buf[this.#nemesisIndex] = symbol;
					this.#nemesisIndex = (this.#nemesisIndex + 1) & NEMESIS_BUF_MASK;
					places[at] = symbol;
					at += 1;
				}
				this.#nemesisLeft -= left;
				decoded += left;
				continue;
			}
			let degree = 0;
			let model = prob.baseModel;
			for (; degree < MAX_DEGREE; degree += 1) {
				const last =
					(this.#lastSymbol[
						(this.#lastSymbolAt + MAX_DEGREE - 1 - degree) & (MAX_DEGREE - 1)
					] ?? 0) >> (ERISA_PROB_SHIFT_COUNT[degree] ?? 0);
				const sub = model.subModel[last];
				if (!sub || sub.symbol < 0) break;
				if (sub.symbol >= prob.workUsed) {
					throw invalidNemesis();
				}
				const next = prob.probIndex[sub.symbol];
				if (!next) throw invalidNemesis();
				model = next;
			}
			const index = this.decodeErisaCodeIndex(model);
			if (index < 0) return decoded;
			let symbol = model.symTable[index]?.symbol ?? -1;
			model.increaseSymbol(index);
			let isPhrase = false;
			if (symbol === ERISA_ESCAPE_CODE) {
				if (model !== prob.baseModel) {
					const baseIndex = this.decodeErisaCodeIndex(prob.baseModel);
					if (baseIndex < 0) return decoded;
					symbol = prob.baseModel.symTable[baseIndex]?.symbol ?? -1;
					prob.baseModel.increaseSymbol(baseIndex);
					if (symbol !== ERISA_ESCAPE_CODE) {
						model.addSymbol(symbol);
					} else {
						isPhrase = true;
					}
				} else {
					isPhrase = true;
				}
			}
			if (isPhrase) {
				// The counts of the walk of the engine of the places of the count of the walk of the engine
				// behind the places of the count of the walk of the picture stand of the counts of the walk
				// of the engine of the count of the walk of the engine of the count of the walk of the
				// picture of its own.
				const phraseIndex = this.decodeErisaCode(this.phraseIndexProb);
				if (phraseIndex === ERISA_ESCAPE_CODE) {
					this.#flagEof = true;
					return decoded;
				}
				let length: number;
				if (0 === phraseIndex) {
					length = this.decodeErisaCode(this.runLenProb);
				} else {
					length = this.decodeErisaCode(this.phraseLenProb);
				}
				if (length === ERISA_ESCAPE_CODE) return decoded;
				const last =
					this.#buf[(this.#nemesisIndex - 1) & NEMESIS_BUF_MASK] ?? 0;
				const phrase = this.#lookup[last];
				this.#nemesisLeft = length;
				if (0 === phraseIndex) {
					this.#nemesisNext = -1;
				} else if (phrase) {
					const found =
						phrase.index[(phrase.first - phraseIndex) & NEMESIS_INDEX_MASK] ??
						0;
					this.#nemesisNext = found;
					if ((this.#buf[this.#nemesisNext] ?? 0) !== last) {
						throw invalidNemesis();
					}
					this.#nemesisNext = (this.#nemesisNext + 1) & NEMESIS_BUF_MASK;
				}
				continue;
			}
			const place = symbol & 0xff;
			this.#lastSymbol[this.#lastSymbolAt] = place;
			this.#lastSymbolAt = (this.#lastSymbolAt + 1) & (MAX_DEGREE - 1);
			const lookup = this.#lookup[place];
			if (lookup) {
				lookup.index[lookup.first] = this.#nemesisIndex;
				lookup.first = (lookup.first + 1) & NEMESIS_INDEX_MASK;
			}
			this.#buf[this.#nemesisIndex] = place;
			this.#nemesisIndex = (this.#nemesisIndex + 1) & NEMESIS_BUF_MASK;
			places[at] = place;
			at += 1;
			decoded += 1;
			if (prob.workUsed < ERISA_PROB_SLOT_MAX) {
				this.#growModel(prob, model, degree, place);
			}
		}
		return decoded;
	}

	/** The counts of the walk of the engine of the model of the walk of the engine of the count of it. */
	#growModel(
		prob: ErisaProbBase,
		model: ErisaProbModel,
		degree: number,
		place: number,
	): void {
		const symbol = place >> (ERISA_PROB_SHIFT_COUNT[degree] ?? 0);
		if (symbol >= model.subModel.length) {
			throw invalidNemesis();
		}
		const sub = model.subModel[symbol];
		if (!sub) throw invalidNemesis();
		sub.occured += 1;
		if (sub.occured < (ERISA_PROB_NEW_LIMIT[degree] ?? 0)) return;
		// The counts of the walk of the engine of the places of the count of the walk of the engine of a
		// count of the walk of the engine of its own stand of the counts of the walk of the engine of the
		// count of the walk of the engine of the count of the walk of the picture itself.
		const parent = model;
		let current = prob.baseModel;
		let degreeAt = 0;
		let found = false;
		for (; degreeAt <= degree; degreeAt += 1) {
			const last =
				(this.#lastSymbol[
					(this.#lastSymbolAt + MAX_DEGREE - 1 - degreeAt) & (MAX_DEGREE - 1)
				] ?? 0) >> (ERISA_PROB_SHIFT_COUNT[degreeAt] ?? 0);
			const step = current.subModel[last];
			if (!step || step.symbol < 0) {
				found = true;
				break;
			}
			if (step.symbol >= prob.workUsed) throw invalidNemesis();
			const next = prob.probIndex[step.symbol];
			if (!next) throw invalidNemesis();
			current = next;
		}
		if (!found) return;
		const last =
			(this.#lastSymbol[
				(this.#lastSymbolAt + MAX_DEGREE - 1 - degreeAt) & (MAX_DEGREE - 1)
			] ?? 0) >> (ERISA_PROB_SHIFT_COUNT[degreeAt] ?? 0);
		const step = current.subModel[last];
		if (!step || step.symbol >= 0) return;
		const created = prob.probIndex[prob.workUsed] ?? new ErisaProbModel();
		prob.probIndex[prob.workUsed] = created;
		step.symbol = prob.workUsed;
		prob.workUsed += 1;
		created.totalCount = 0;
		let at = 0;
		for (let placeAt = 0; placeAt < parent.symbolSorts; placeAt += 1) {
			const row = parent.symTable[placeAt];
			if (!row) continue;
			const occured = (row.occured >> 4) & 0xffff;
			if (occured > 0 && row.symbol !== ERISA_ESCAPE_CODE) {
				created.totalCount += occured;
				const target = created.symTable[at];
				if (target) {
					target.occured = occured;
					target.symbol = row.symbol;
				}
				at += 1;
			}
		}
		created.totalCount += 1;
		const escapeRow = created.symTable[at];
		if (escapeRow) {
			escapeRow.occured = 1;
			escapeRow.symbol = ERISA_ESCAPE_CODE;
		}
		created.symbolSorts = at + 1;
		for (const row of created.subModel) {
			row.occured = 0;
			row.symbol = -1;
		}
	}
}
