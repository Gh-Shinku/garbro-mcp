# Illusion resource archive (`illusion-pp-archive`)

Reference: `ArcFormats/Illusion/ArcPP.cs`, class `PpOpener`, tag `PP/ILLUSION`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What the format is

An archive of this engine begins with the word `[PPVER]\0`, and the nine places behind it stand of a cipher
of the engine's own:

```text
count of the version of the engine   4 places at 0
count of the walk of an entry        1 place  at 4   (at most the fourth count)
count of the files of the index      4 places at 5
```

Every one of those three counts is read of its **own** call of `DecryptIndex`, so the keys stand as they
stand at the head of every one of them. The cipher stands of two keys of eight places that the reference
holds in its own source: the first key stands of the second one, place by place, as the walk of the file
goes on, and the place of the file stands of the place of the first key of that step (`key0[i & 7] +=
key1[i & 7]`, cycled over the eight places of the key).

The index stands at `0x11`, of `count * 0x120` places, and stands of the same cipher over its whole length.
Every record holds the name of a file of the engine of `0x104` places, the count of the places of the file
and the count of its places in the file, at `0x104` and at `0x108` of the record. `CheckPlacement` refuses
the whole archive where a file reaches past the end of it, the count of the version of the engine has to
stand at `0x6C` or behind it, and the count of the places of the walk of an entry has to stand at the fourth
count at most.

The places of a *file* of the engine stand of a scheme the reference looks up by the **name of the game**
(`QueryEncryptionScheme`, through the catalogue and `PpScheme.KnownKeys`), which ships empty: with no scheme
the reference refuses the whole archive, whatever the walk of the places of an entry may be.

## The port

`packages/formats/src/illusion/pp-archive.ts` carries the head, the cipher of the head and of the index, and
the index itself - none of which stands of a scheme. What the walk of the *places of a file* stands of is
written down here rather than carried as code, the reference reaching it only through a key it asks for:

* the counts **0**, **1** and **2** stand of the places of the scheme's key, of one, two and four places of
  the file at a time, cycled over the key (`DecryptData1`),
* the count **3** stands of two keys of four words, of the first one standing of the second one after every
  place of the file, over two places of the file at a time (`DecryptData3`),
* the count **4** stands of `UnpackData`, a **stub** in the reference that hands the places of the file back
  as they stand.

## Deviations from the reference

* The reference refuses the **whole archive** where `QueryEncryptionScheme` answers with no scheme, which for
  a shipped reference is every archive of this engine. This port lists the files of such an archive and
  answers for their places of the walk the archive itself names in the count of the places of its entry: no
  walk at all at the counts 0, 2 and 4 (methods the scheme of the game does not enter, the fourth standing of
  the reference's own stub), and a refusal named `UNSUPPORTED_FEATURE` at the counts 1 and 3, where the walk
  of the reference stands of a scheme of the game rather than of the file. The same shape of departure
  stands in `tactics-arc2`, of the same reason.
* The port reads the whole file into memory to walk the index, where the reference reads the head and the
  index alone. The counts of the head are bounded before the index is read, so the whole-file read is a
  convenience rather than a requirement.

## Verification

`tests/formats/illusion-pp-archive.test.ts` (4 tests):

* the two keys of the cipher, against the reference's own text, and the first **nine** places of the walk
  worked out **by hand** (`34 2c 02 de b6 6b 29 08 6e`: the first key standing of the second one, and the
  ninth place standing of the first place of the key again, `0x34 + 0x3A`);
* the listing of a two file archive of the count 2, its names, the counts of its files and of its places, and
  the places of a file of it handed over as they stand;
* the count 4 of the walk of an entry (the reference's stub, `UnpackData`) and the named refusal at the
  counts 1 and 3;
* the refusals: a head of another word, a count of the version below `0x6C`, a count of the walk of an entry
  above the fourth count, no file at all in the index, and a file of the engine standing past the end of the
  archive.
