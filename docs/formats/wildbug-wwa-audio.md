# Wild Bug WWA audio

Reference: `ArcFormats/WildBug/AudioWWA.cs`, class `WwaAudio` with the `WwaReader` beside it, which stands
on the `WpxDecoder` and `WpxSection` of `ArcFormats/WildBug/ImageWBM.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `wildbug-wwa-audio`
(`packages/formats/src/wildbug/wwa-audio.ts`), with the head and the record walk shared in
`wildbug/wpx-section.ts` for the picture format that will need them as well.

## The head both kinds carry

A file of this engine opens with the word `WPX\x1a`, then three bytes that name what it holds - `WAV` for a
sound, `BMP` for a picture - then a byte that has to be one, the number of records and the size of one
record. The records follow, each opening with a byte of its own, a byte that says how the section is stored,
and three words: where the section stands, how long it is stored, and how long it unfolds to.

This port walks the records inside the directory's own bounds and refuses a record narrower than the fields
it holds; the reference only asks that the record size is not zero, and compares the byte it is looking for
before it checks that the walk is still inside the directory, so its last comparison reads past the end.

## The sound

The record that opens with `0x20` holds the format of the sound, and the one that opens with `0x21` holds its
samples. The reference insists that the format record is stored with the one way a sound of this engine
knows, `0x80`, that it is at least sixteen bytes long, and that both records are there; this port refuses
the sound otherwise.

Because of that insistence the reader always takes its **stored** path: the `WwaReader` would unpack a
packed section for other ways of storing one, and the reference states plainly that two of those ways, and
one branch of a third, throw `NotImplementedException`. Only the stored path is reachable through the
container, so it is the only one ported here.

The samples are then wrapped in a wave file whose head this port writes itself: the reference copies the
format block **as it stands**, which may be longer than the sixteen bytes a plain wave carries, rather than
writing the canonical forty four byte head the project's own wave writer produces.

The reference reads the samples at whatever place its stream has reached, which is the end of the format
block, and not at the place the sample record names. Those two places are the same for every file whose
records stand one behind the other, which is every file the reference can read; for a file that keeps them
apart this port takes the record's own place instead.

## Deviations from the reference

* The samples are read at the place their own record names, as described above.
* Every read is bounded: a record that names bytes past the end of the file is refused, where the reference
  would throw an end of stream error, and a directory too short for its own records is refused as well.
* A head whose version byte is not one, and a head that names no records, are refused.

## Verification

Seven tests build files with a mirror writer: a sound whose samples are wrapped in a wave file, checked byte
by byte against the head the reference writes and then read back with the project's own wave reader, which
agrees on the format, the place of the samples and their length; a format block longer than a plain wave one,
which a canonical writer would drop bytes from; a directory whose records stand in another order, where the
samples must come from the place their own record names; a directory whose records are wider than they need
to be; telling a sound of this engine from a picture of it by the three bytes behind the word; the walk of
the records inside the directory's own bounds; and the refusals - no format record, a format record stored
another way, a format block too short, no sample record, samples reaching past the file, another version, no
records, a record narrower than its fields, and a head that stops short.

What stands on the reference alone: no fixture here holds a packed section, which the container makes
unreachable anyway; and no real file is on hand to compare against GARbro's output.
