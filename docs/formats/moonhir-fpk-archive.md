# MoonhirGames engine resource archive

Reference: `ArcFormats/Moonhir/ArcFPK.cs`, class `FpkOpener` with its `FpkEntry` and `FpkArchive` beside it.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `moonhir-fpk-archive`
(`packages/formats/src/moonhir/fpk-archive.ts`).

## The head and the index

The archive opens with `FPK` and the mark of its only version, `0100`, then names where its index begins and
how many entries stand in it. Every record of the index is twenty four bytes: a word that says whether the
entry is keyed, the place and the length of the entry, and a name of twelve bytes. A name ending in `.fbx`
holds a picture of this engine, and the reference types such an entry as an image **unless** the archive's own
file name begins with `scr`, in which case it leaves it untyped - which this port keeps.

## The key, and what the reference does without one

There is no key in the head. The two words that stand behind the end of the first keyed entry longer than
eight bytes are what tells it: the arithmetic of the cipher, taken backwards, is asked to name the length of
the entry itself, and the key that answers with it is the one the archive is read with. The reference carries
exactly **one** ready made key, the key of nothing, so an archive written with any other key leaves it holding
no key at all: it then hands the archive over **without** one and refuses such an entry when its bytes are
asked for. This port keeps both halves of that: the entries the reference holds no key for are marked
`encrypted` and refused with a message of their own.

The cipher walks the words of an entry from its **last** back to its first: every word loses a place of its
own and then meets a key that walks on with the word just written. The walk leaves a shorter run than the
eight bytes the reference reads a length from alone, and the two words behind the end name how long the entry
really is, which the reference cuts the decrypted data down to.

## The pictures

A picture of this engine opens with its own word, and its head says where its packed bytes begin and how large
the picture is. The walk of those bytes reads its control bits **two at a time from the lowest up**, every
byte of them naming four decisions, and a decision is one of four things:

* a byte of its own;
* a run of the bytes that stand behind it, two longer than the byte that names it;
* a copy out of the place behind the one the walk has reached, the place and the count sharing two bytes -
  the count of the low five bits plus four, the place of the rest - and copied progressively, so a run that
  reaches into itself runs on;
* the fourth way, which carries a longer form of both of those, or a stretch of bytes the picture holds no
  room for that is stepped over - and which, in its last form, forces the control bits to be read anew.

The packed length the head names is never asked for: the walk ends where the picture does.

## Deviations from the reference

* Every read and every run is bounded by the file and by the picture; the reference walks past both.
* A picture that names more than two hundred and fifty six million bytes, or a run longer than a million, is
  refused.
* A keyed entry whose words name a length it does not hold is refused rather than cut down to nothing.

## Verification

Eight tests over synthetic fixtures (`tests/formats/moonhir-fpk-archive.test.ts`): an archive of two entries
listed and handed over; a picture drawn out of its own walk, with the run and the lengths of the control bits
pinned; a stretch the picture holds no room for stepped over with its control bits read anew; a long run of
the fourth way; an archive whose key is found behind the end of its keyed entry, with the payload built by
**turning the cipher round** and read back through it - and the same archive under another key turned away; the
words of the cipher walked back over a payload of their own; and a mark, a count and an entry the format does
not name.
