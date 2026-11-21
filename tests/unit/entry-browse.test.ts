import type { ArchiveEntry } from "@garbro-mcp/core";
import { expect, it } from "vitest";
import {
	entryBrowseOverview,
	selectEntryGroup,
} from "../../packages/core/src/entry-browse.js";

function entries(paths: string[]): ArchiveEntry[] {
	return paths.map((path, index) => ({
		id: String(index),
		path,
		size: 1n,
		packedSize: 1n,
		compressed: false,
		encrypted: false,
	}));
}

it("groups flat names by their prefix and reuses each exact selector", () => {
	const files = entries([
		"背景01.png",
		"背景02.png",
		"face_01.png",
		"face_02.png",
		"readme.txt",
	]);
	const { groups } = entryBrowseOverview(files, {});
	expect(
		groups.map(({ browse, count }) => [browse.by, browse.key, count]),
	).toEqual([
		["prefix", "背景", 2],
		["prefix", "face", 2],
		["prefix", "", 1],
	]);
	for (const { browse, count } of groups)
		expect(selectEntryGroup(files, browse)).toHaveLength(count);
	expect(selectEntryGroup(files, groups[1]?.browse ?? {})).toEqual(
		files.slice(2, 4),
	);
});

it("pages directory groups independently and compares their keys literally", () => {
	const files = entries(
		Array.from({ length: 23 }, (_, n) => `dir[${n}]/image.png`),
	);
	const first = entryBrowseOverview(files, {});
	expect(first).toMatchObject({ totalGroups: 23, nextGroupOffset: 20 });
	const second = entryBrowseOverview(files, { offset: 20 });
	expect(second).toMatchObject({
		nextGroupOffset: null,
		groups: [
			{ browse: { by: "directory", key: "dir[20]" } },
			{ browse: { key: "dir[21]" } },
			{ browse: { key: "dir[22]" } },
		],
	});
	expect(selectEntryGroup(files, second.groups[0]?.browse ?? {})).toEqual([
		files[20],
	]);
});

it("samples distinct positions in archive order even for short or opaque lists", () => {
	for (const paths of [
		["00000.ogg", "00001.ogg", "00002.ogg", "00003.ogg"],
		["FF24A123", "DD34BCDF", "CA12FF34", "BCDAABCD"],
		[
			"z2075#00043.ogg",
			"z2075#00121.ogg",
			"z2075#00303.ogg",
			"z2075#00654.ogg",
		],
	]) {
		const overview = entryBrowseOverview(entries(paths), {});
		expect(overview.groups).toEqual([]);
		expect(overview.samples.map((sample) => sample.path)).toEqual([
			paths[0],
			paths[1],
			paths[3],
		]);
	}
	for (const size of [0, 1, 2]) {
		const files = entries(["a", "b"].slice(0, size));
		expect(
			entryBrowseOverview(files, {}).samples.map((sample) => sample.id),
		).toEqual(files.map((entry) => entry.id));
	}
});
