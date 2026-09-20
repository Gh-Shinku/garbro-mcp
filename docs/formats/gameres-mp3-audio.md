# MPEG Layer 3 audio format

Reference: `GARbro/ArcFormats/AudioMP3.cs`, classes `Mp3Audio` and `Mp3Input`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gameres/mp3-audio.ts` (`gameresMp3AudioDescriptor`,
`gameresMp3AudioFormat`, id `gameres-mp3-audio`, `looksLikeMp3`, `skipId3Tag`).

The reference registers the word of nothing for this format and reads no extension of its own, so **every**
file that no other format claimed is offered to it and one that does not read as a stream of MPEG Layer 3 is
not claimed. Two things are looked at:

* a **tag** in front of the stream: the three letters `ID3` and a length in four seven bit groups at offsets
  six to nine, which the reference takes only when those four bytes and the two flags before them have their
  top bit clear. A tag of a version past the third whose footer flag is set at offset five is ten bytes longer
  than that length says. Behind the tag comes a frame;
* the **sync word** of a frame: `0xFF`, then `0xE2` in the bits `0xE6` of the byte behind it, then a byte whose
  top nibble is **not** `0xF0`. Where the first byte of the file is not `0xFF`, the reference looks for the
  first `0xFF` in the `0x300` bytes behind it — stopping four bytes short of that window — and the whole test
  then rests on that one byte, so the first `0xFF` that fails the rest of it ends the search.

The stream is handed out **as it stands**, because the project carries no decoder for it: the reference
decodes it through `Mp3Input` and hands back the samples of the sound, while the port hands back the bytes
payload is a stream of MPEG Layer 3 — `macromedia-edim-audio`, `c4-vmd-audio` and `regrips-mrg-audio` among
them. The entry is named after the file with an `mp3` extension, and `Macromedia SND`

The tests cover a stream that starts with a frame, a tag in front of one — with and without its footer — a
tag whose length does not reach a frame, the sync word looked for a little way into the file, the two ends of
the window that search is bounded by, a file whose bytes do not read as a frame, one too short to hold a
frame, and the stream handed out as it stands.
