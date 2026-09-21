# SakanaGL engine resource archive

Reference: `Experimental/SakanaGL/ArcSX.cs`, classes `SxOpener` (tag `SXSTORAGE`) and
`SxIndexDeserializer`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as
`sakanagl-sx-archive` (`packages/formats/src/sakanagl/sx-archive.ts`).

## The index stands beside the container

A container of this engine writes **no index of its own**. Its index stands in a file of its own beside it,
under the **first four characters** of the container's name with `(00).sx` behind them - or, when that is not
there, under the name before the last dash with `(00).sx` behind it. The file must open with the words
`SSXXDEFL`, and the index is written from behind a head of sixteen bytes, whose eighth byte holds a key word.

That key leans on the length of the whole index as well: the word, the length and the key the engine fixes are
mixed in **sixty-four bits** before the two halves of the result are handed to the cipher. The payload behind
the head is unkeyed with them and then unpacked with **zstd**, the size it takes unpacked standing in its own
first four bytes - big endian, like every number in this index.

## The cipher

A run is keyed a **thirty-two bit word** at a time, each word exclusive-ored with a word of a sequence that
steps four words at a time through shifts and additions of its own. Nothing in the sequence stands on the
bytes of the run, so **the same call both keys and unkeys** - which is how the fixtures of this port are
written as well as read.

## The index itself

Behind the head: the names of the tree, then the entries, then a table of the containers this index stands
over, then the tree that names the entries.

```text
names      i32 (big endian) how many; then, to each: one byte of length, then the name in UTF-8
entries    i32 how many; then, to each: u16 arc, u16 flags, u32 place (in units of 16), u32 length
table      u16 how many; then, to each: 40 bytes, of which the fourth word is that container's own length
skipped    u16 how many; then that many records of 24 bytes
tree       to each node: u16 children, i32 name, i32 file - where a file of nothing means a directory
```

An entry's own place stands in units of **sixteen bytes**. Its flags say what it is: the low two bits say
whether it is packed, and the bit at 0x10 says whether it is **not** keyed. An entry that is neither stands as
it is; one that is keyed takes the cipher again, with a key built from its own place and length; one that is
packed unpacks with zstd.

When the index stands over **several** containers, only the entries of the one whose own length is the length
of this very file are listed, and the rest stand aside. An entry the tree never names has no name to offer, so
it is left out of the listing.

## Deviations from the reference

* Names are joined with a forward slash, where the reference's `Path.Combine` uses the separator of the
  platform it runs on.
* The zstd runs are unpacked with the zstd the runtime itself carries (`node:zlib`), which the reference
  reaches through `ZstdNet`. The size the run names is checked against what comes back.
* Every read is bounded to the file and to the index; a size that does not match what a packed run unpacks to
  is refused rather than handed over.
* An entry the tree never names, and a table record that reaches past the index, are refused.

## Verification

Six tests. Two of them pin arithmetic against values worked out **aside** from this port, in Python: the
cipher on an eight byte run with a key of its own - checked byte for byte, and then checked again by keying
the same bytes with a second, mirrored implementation of the same arithmetic - and the key the index leans on
for a head of its own. The other four run over **real files** in a temporary directory: a container of three
entries (one plain, one packed and one keyed) under a small tree of names, extracted one by one; a container
of two entries in one index, where only the one whose own length matches is listed; the refusals, for a
container with no index beside it and one whose index does not open with the engine's words; and the shape
test itself, where the same bytes under another name are not read.

What stands on the reference alone: no real game is on hand to compare against GARbro's output, the
alternate index name (the one before the last dash) is read but no fixture carries it, and the skipped
records of the tail are stepped over without being read.
