# NScripter engine resource archive

Reference: `ArcFormats/NScripter/ArcNS2.cs`, class `Ns2Opener` (tag `NS2`). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `nscripter-ns2-archive`
(`packages/formats/src/nscripter/ns2-archive.ts`).

## The index

The first word of the file names where the index ends and the data begins. Between that head and the place it
names stands a run of records, one to an entry:

```text
"          one byte, the mark every record opens with
name       the entry's own name, in the Japanese code page the engine keeps its names in, up to the mark
"          the closing mark
size       u32, how many bytes the entry takes
```

The entries themselves stand **one behind the other** from the place the head named, so an entry's own place
is the sum of the sizes before it - the index says nothing about where an entry stands, only how long it is.

A record whose first character is not the mark **ends** the walk, so a container may carry a few bytes of
nothing between its index and its data without harm. A name of nothing, a name that fills the whole of the
reference's own name buffer, and an entry that reaches past the file are each refused, and a file whose head
names a place inside its own head or past its own end is not a container of this engine at all.

## The way this port does not take

The reference has a **second** way for an encrypted container: it asks the person running it for a password
(`QueryPassword`) and keeps the answers it has been given in `KnownKeys`, which ships as an empty dictionary.
With nothing in it and no password prompted for, that way opens nothing, so this port keeps only the plain
index - the way a stock build reads a container of this engine.

## Deviations from the reference

* The reference reads the index as a run of **characters** through a reader of the Japanese code page; this
  port finds the closing mark by looking for the byte itself. A name whose own bytes contain the mark as the
  second half of a two byte character would therefore end early here, where the reference would read on. The
  name itself is decoded with the same code page, so an ordinary name of any length comes out the same.
* Every read is bounded to the file; the reference reads through the end of its own view in places.

## Verification

Six tests on hand-built containers: an index of three records, with the names, the consecutive places the
entries take and their sizes all checked; a name of two bytes in the engine's own code page; the entries
themselves handed over byte for byte; a container whose index is followed by bytes of nothing, which ends the
walk with the entries read so far; the refusals, for a head naming a place inside itself, past the file, and
for an index whose name is empty or whose entry reaches past the file; and the shape test itself, which takes
a name of another kind as readily as its own, since the reference tries this index for any file.

What stands on the reference alone: the encrypted way, the password prompt behind it, and the reader of the
keyed stream it uses (`Ns2Stream`, which folds a key through MD5 in blocks of thirty-two bytes) are **not
ported** - no fixture reaches them and no password is on hand to check one against.
