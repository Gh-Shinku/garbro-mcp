# ACTGS engine resource archive

Reference: `ArcFormats/Actgs/ArcDAT.cs`, class `DatOpener` with its `IndexReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `actgs-dat-archive`
(`packages/formats/src/actgs/dat-archive.ts`).

## The head and the index

The archive opens with no word of its own: the reference tells it by its name - a `.dat` - and by the shape of
its head. The first word says how many entries stand behind it and has to be sane, and the three words behind
it have to be **nothing**. The index follows at 0x10, thirty two bytes to an entry: where the entry stands,
how long it is, and its name, a field of twenty four bytes cut at its first nothing.

Every entry has to stand inside the archive (`Entry.CheckPlacement`), which this port asks of the shared
`checkPlacement` with the file's own length. The index is read here from one buffer rather than from the
stream the reference makes of it, so a record that reaches past the end of that stream is refused instead of
being read as far as the stream goes.

## The keyed way, which is refused

The reference reads its index through a stream of its own and compares the place the **first entry names**
with the place the index **ends** at. When the two part, the archive is keyed: the reference then looks the
key up in `KnownKeys` by the two places exclusive-ored together and refuses the archive when the table holds
nothing. That table ships **empty** in the reference itself -

```csharp
static ActressScheme DefaultScheme = new ActressScheme { KnownKeys = Array.Empty<byte[]>() };
```

- so a keyed archive of this engine cannot be read by a stock GARbro build at all. This port refuses that way
by name, with a message saying as much, and reads the plain way, which is the only one the reference can
reach. For the same reason no entry of a plain archive is unwrapped: every way the reference knows to unwrap
one - the keyed `.scr` runs, the `PAK ` packed streams, the keyed entry headers - stands behind the archive's
key, so a plain archive hands its entries over as they are.

## Verification

Seven tests over synthetic fixtures (`tests/formats/actgs-dat-archive.test.ts`): a plain archive with two
entries listed and handed over, the head and the index read field by field, a head that names no entry and
heads carrying a word of their own, an entry reaching past the end of the archive, a keyed archive turned
away with the reason of its own, a name that fills the whole twenty four byte field and an empty one, and the
name the reference tells the archive by. The fixtures build the archive the way the engine lays it out - head,
records, then the data the records name - so the index reader is pinned against a layout rather than against a
copy of itself.
