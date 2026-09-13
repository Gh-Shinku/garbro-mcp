# BeF VZY obfuscated wave audio

Reference: `GARbro/ArcFormats/BeF/AudioVZY.cs`, class `VzyAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/bef/vzy-audio.ts` (`vzyAudioDescriptor`, `vzyAudioFormat`, id
`bef-vzy-audio`).

A wave file with **two runs of zeros where its markers belong**: bytes zero to three, where `RIFF` belongs, and
bytes eight to fifteen, where `WAVE` and `fmt ` belong. Everything else is untouched — the size field at four,
the format chunk's length at `0x10`, its body at `0x14`, and the payload. The obfuscation is therefore
positional rather than a mask, and the port reverses it exactly as the reference does: it rebuilds the sixteen
byte prefix (`RIFF` + the stored size field + `WAVE` + `fmt `) and appends the stored bytes from offset sixteen.

Because the prefix replaces the same sixteen bytes the file already has, the rebuilt wave is the same length as
the stored file, and a test asserts that the extraction output equals the file with those two runs restored —
byte for byte. Rebuilding is also what makes the reconstruction self-checking: the shared `readWave` helper
parses the result afterwards, so a file whose region is not really a wave is declined no matter what its first
eighteen bytes look like.

The reference makes four structural checks, and the port keeps all of them:

* the declared `riff_length` must account for the whole file, `length == riff_length + 8`, which also rules out
  a negative value — a test appends one byte and expects a decline;
* the format chunk length must be at least sixteen and no more than the declared length — one test declares
  fifteen and another declares `0x7fff`;
* the `data` marker is read at `0x14 + format_length`, right after the format body, **without** the word
  alignment a wave writer would apply to an odd sized chunk. The port reproduces that check before parsing, and
  a test moves the marker away;
* the file must be long enough for the header it asks for, which `ReadHeader` enforces by throwing.

The port exposes the resource as a single entry:

* extraction writes a **canonical** wave file through the shared `writeWave` helper, the same shape the WAZ and
  WRG audio ports use, so any chunk beyond the format and data ones is dropped. A test appends a `LIST` chunk
  after the payload and asserts that the output is the original wave without it, which is why `sizeKnown` is
  false;
* the entry is named after the source file with a `wav` extension, covers the whole stored file, and is flagged
  `encrypted: true` because the markers were overwritten;
* per the repository convention for audio ports, entry and archive metadata carry `type: "audio"`,
  `format: "wav"`, the format tag, channel count, sample rate and bit depth, plus `encrypted: true`; the archive
  metadata adds the `pcmSize` taken from the data chunk;
* the reference declares no signature and no extensions, so the descriptor registers neither and detection rests
  on the zeroed markers and the structural checks. One test confirms that a file with a non-zero `RIFF` and
  another with a non-zero byte inside the second run are both declined.

GARbro's `CanWrite` is false, so encoding is out of scope.

## A fixture note

The test's wave builder originally allocated the format body at the declared length and then wrote all six
format fields into it. Declaring a fifteen byte chunk therefore wrote past the end of the buffer, and `Buffer`
silently drops such writes rather than throwing — the same hazard recorded for the MSK and PBM fixtures in this
repository. The builder now allocates at least sixteen bytes and truncates the body afterwards, so the declared
length is what the file actually has.
