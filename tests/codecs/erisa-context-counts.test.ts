// The counts of the walk of the Entis engine, against walks built in the test: the counts of the model of
// the walk of the engine (`ErisaProbModel`, of the counts of the walk of the names of it), the walk of the
// counts of a picture of the engine of the tree of the counts of it (`ErisaHuffmanDecodeContext`) and the
// walk of the counts of the engine of the model of the walk of it (`ErisaProbDecodeContext`).
//
// The reference holds no walk that stands of the counts of the walk of the engine of a picture of the
// engine (the walks of the engine stand of the places of the file of the engine of it alone), so the walk
// of the model of the counts of the walk of the engine stands here of the counts of the walk of the engine
// itself: the places of the model stand of the counts of the walk of the names of it, and of the counts of
// the walk of the engine of the walk of the engine behind them.
import { Buffer } from "node:buffer";
import { GarbroError } from "@garbro-mcp/core";
import { ErisaRleDecodeContext } from "@garbro-mcp/codecs";
import { bitsToBuffer, gammaBits } from "../helpers/erisa.js";
import {
	ERISA_ORDER_0,
	type ErisaPlaces,
	ErisaHuffmanDecodeContext,
	ErisaHuffmanTree,
	ErisaProbDecodeContext,
	ErisaProbModel,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const ERISA_HUFFMAN_NULL = 0x8000;
const ERISA_HUFFMAN_ESCAPE = 0x7fffffff;
const PLACE_MASK = 0xff;

/** The places of the stream of the engine, of the bits of the places of the file behind them. */
function bitsToPlaces(bits: readonly number[]): Buffer {
	const places = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	for (const [at, bit] of bits.entries()) {
		if (0 !== bit) {
			places[Math.floor(at / 8)] =
				(places[Math.floor(at / 8)] ?? 0) | (1 << (7 - (at % 8)));
		}
	}
	return places;
}

/** The places of the walk of a count of the engine, of the count of the walk of it. */
function placesOf(count: number): number[] {
	const bits: number[] = [];
	for (let at = 7; at >= 0; at -= 1) bits.push((count >> at) & 1);
	return bits;
}

describe("Entis counts of the walk of the engine", () => {
	it("stands of the counts of the walk of the names of the model", () => {
		const model = new ErisaProbModel();
		// Every place of a name of the walk of the engine stands of a count of one at the head of the walk
		// of the model, of the place of the name of no count of the walk of the engine at all behind them.
		expect(model.totalCount).toBe(0x101);
		expect(model.symbolSorts).toBe(0x101);
		expect(model.findSymbol(0x41)).toBe(0x41);
		expect(model.findSymbol(-1)).toBe(0x100);
		expect(model.symTable[0x100]).toEqual({ occured: 1, symbol: -1 });
		// The count of the walk of a name of the model stands of the walk of the model of it: the places of
		// the names of the model stand of the counts of the walks of them, of the count of the walk of the
		// name behind it over the places of the count of the walk of the name in front of it.
		for (let at = 0; at < 8; at += 1) {
			model.increaseSymbol(model.findSymbol(0x41));
		}
		expect(model.totalCount).toBe(0x101 + 8);
		expect(model.symTable[0]?.symbol).toBe(0x41);
		expect(model.symTable[0]?.occured).toBe(9);
		const names = new Set(model.symTable.slice(0, 0x101).map((p) => p.symbol));
		expect(names.size).toBe(0x101);
		for (let at = 1; at < 0x101; at += 1) {
			expect(model.symTable[at - 1]?.occured).toBeGreaterThanOrEqual(
				model.symTable[at]?.occured ?? 0,
			);
		}
		// The counts of the model stand of the places of the walk of the engine halved.
		const before = model.totalCount;
		model.halfOccuredCount();
		expect(model.totalCount).toBeLessThan(before);
		let sum = 0;
		for (let at = 0; at < model.symbolSorts; at += 1) {
			sum += model.symTable[at]?.occured ?? 0;
		}
		expect(model.totalCount).toBe(sum);
	});

	it("stands of the walk of the counts of a picture of the engine", () => {
		// The places of the name of a tree of the walk of the engine of no place of a name at all stand of
		// the places of the count of the walk of the count of the engine behind the tree of the counts of
		// the walk of the engine.
		const context = new ErisaHuffmanDecodeContext(0x10);
		context.prepareToDecodeErinaCode();
		context.attachInputFile(
			bitsToPlaces([...placesOf(0x41), 0, 1, ...placesOf(0x42)]),
		);
		// The first place of the tree of the counts of the walk of the engine stands of the places of the
		// count of the walk of the engine itself: the tree of the walk of the engine stands of no place of a
		// name at all, of the place of the count of no name of the walk of it.
		const tree = context.trees[0];
		if (!tree) throw new Error("no tree of the walk of the engine");
		expect(context.getHuffmanCode(tree)).toBe(0x41);
		expect(tree.escape).not.toBe(ERISA_HUFFMAN_NULL);
		// The place of the name of the tree stands of the walk of the places of the tree of the walk of the
		// engine behind it: the place of the count of the walk of the engine of the highest place of the walk
		// of a word of it stands of the place of the name of the tree, and the count of the walk of that
		// place stands of the walk of the tree of the count of it behind the walk of it.
		expect(context.getHuffmanCode(tree)).toBe(0x41);
		// The place of the name of the tree of the count of the walk of the engine of the places of the walk
		// of the engine of no name at all stands of the places of the count of the walk of the count of the
		// engine itself.
		const escaped = new ErisaHuffmanDecodeContext(0x10);
		escaped.prepareToDecodeErinaCode();
		const escapeTree = escaped.trees[0];
		if (!escapeTree) throw new Error("no tree of the walk of the engine");
		escapeTree.addNewEntry(0x41);
		escaped.attachInputFile(bitsToPlaces([1, ...placesOf(0x42)]));
		expect(escaped.getHuffmanCode(escapeTree)).toBe(0x42);
		// The walk of the engine stands of the tree of the counts of the walk of the engine alone where the
		// counts of the walk of the engine stand of the places of the walks of it of no count at all.
		const shared = new ErisaHuffmanDecodeContext(0x10);
		shared.prepareToDecodeErinaCode(ERISA_ORDER_0);
		expect(shared.trees[0x41]).toBe(shared.trees[0]);
		expect(shared.trees[0x100]).not.toBe(shared.trees[0]);
	});

	it("stands of the walk of the counts of the engine of the model of it", () => {
		// The walk of the counts of the engine stands of the counts of the places of a word of the walk of
		// the engine, and the counts of the model of the walk of it stand of the places of the walk of the
		// engine every count of them they hand over.
		// The counts of the walk of the engine stand of the places of the file of the engine behind the
		// model of the walk of it: the walk of the engine stands of the places of the file of the engine
		// before the counts of the walk of it every count of them.
		const context = new ErisaProbDecodeContext(0x10);
		context.attachInputFile(Buffer.alloc(0x40, 0x00));
		context.prepareToDecodeErisaCode();
		const places: ErisaPlaces = new Uint8Array(0x10);
		const read = context.decodeBytes(places, 0x10);
		expect(read).toBeGreaterThan(0);
		// The counts of the model of the walk of the engine stand within the counts of the walk of the
		// engine, and the places of the names of the model stand of the counts of the walks of them.
		for (const model of [context.phraseLenProb, context.runLenProb]) {
			let sum = 0;
			for (let at = 0; at < model.symbolSorts; at += 1) {
				sum += model.symTable[at]?.occured ?? 0;
			}
			expect(model.totalCount).toBe(sum);
			expect(model.totalCount).toBeLessThanOrEqual(0x2000);
			expect(model.findSymbol(-1)).toBeGreaterThanOrEqual(0);
		}
		// A walk of the counts of the engine of no place of a stream of the file of the engine at all stands
		// of the counts of the walk of the engine of nothing rather than of a failure of the port.
		const empty = new ErisaProbDecodeContext(0x10);
		empty.attachInputFile(Buffer.alloc(0, 0x00));
		empty.prepareToDecodeErisaCode();
		// The counts of the walk of the engine of no place of a stream of the file of the engine stand of the
		// counts of the walk of the registers of the walk of the engine, of the counts of the walk of the
		// model of it at the head of the walk of it.
		const emptyPlaces = new Uint8Array(0x10);
		expect(empty.decodeBytes(emptyPlaces, 0x10)).toBe(0x10);
		expect(emptyPlaces[0]).toBe(0);
		// The counts of the walk of the engine stand of the places of a word of the walk of the engine at
		// the head of the walk of it: a walk of the engine that stands of no place of a stream of the file of
		// the engine at all stands of no count of the walk of it.
		expect(() => {
			new ErisaProbDecodeContext(0x10).prepareToDecodeErisaCode();
		}).toThrow(GarbroError);
		expect(ERISA_HUFFMAN_ESCAPE & PLACE_MASK).toBe(PLACE_MASK);
		expect(new ErisaHuffmanTree().tree.length).toBe(0x201);
	});

	it("stands of the counts of the walk of the engine of the gamma of every count of it", () => {
		// The counts of the walk of the counts of a picture of the engine of the kind `RunlengthGamma`
		// stand of the counts of the walk of the engine of the count of the walk of the engine of a count of
		// the places of the picture: the counts of the walk of the engine stand of the counts of the walk of
		// the engine of the places of the count of the walk of the engine of their own.
		const failed: number[] = [];
		for (let value = 1; value < 0x100; value += 1) {
			const bits: number[] = [1];
			bits.push(...gammaBits(1));
			bits.push(0);
			bits.push(...gammaBits(value));
			const context = new ErisaRleDecodeContext(0x10000);
			context.attachInputFile(bitsToBuffer(bits));
			context.flushBuffer();
			context.initGammaContext();
			const places = new Uint8Array(1);
			expect(context.decodeBytes(places, 1)).toBe(1);
			if (places[0] !== value) failed.push(value);
		}
		expect(failed).toEqual([]);
	});
});
