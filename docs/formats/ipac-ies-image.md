# IPAC image format

Reference: `GARbro/ArcFormats/Ipac/ImageIES.cs`, classes `IesFormat` and `IesRawFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ipac/ies-image.ts` (`ipacIesImageDescriptor`, `ipacIesImageFormat`, id
`ipac-ies-image`, and `ipacIesRawImageDescriptor`, `ipacIesRawImageFormat`, id `ipac-ies-raw-image`;
`readIesLayout`, `readIesRawLayout`, `readIesPalette`).

The reference holds two pictures in one source, and this port keeps them as two formats with the tags they
carry.

## `IES`: the signed picture

The file begins with the word `IES2`, and the width, the height and the depth stand at eight, twelve and
sixteen. Only a depth of **eight** or **twenty four** bits is read; the reference throws for any other when it
is asked to unpack, so such a file is not offered as this format.

Twenty four bits a pixel are read from `0x420`: three bytes a pixel and then one alpha byte each, in two
blocks whose bytes are interleaved into the blue, green, red, alpha pixels the reference hands out. Eight bits
a pixel are a colour map of two hundred and fifty six four byte entries of red, green, blue and nothing at
`0x20`, with the pixels behind it at `0x420`. A stream that stops inside the pixels or the colour map is
refused, which is what the reference's own length checks do as well.

## `IES/RAW`: the picture with no signature

This kind declares no signature word; the reference gates on the `.ies` extension, and the port does too. The
width and the height stand at the start of the sixteen byte head, the depth at eight, and the word at twelve
must be clear. The pixels behind the four hundred and thirty six bytes of head and colour map must be
**exactly** the size the measurements and the depth ask for, which is the reference's own check; a file whose
size does not agree is turned away.

Thirty two bits a pixel are read from `0x414` as blue, green, red, alpha. Eight bits a pixel are a colour map
of the same shape at `0x14`, with the pixels behind it at `0x414`. Only those two depths are read, as the
reference reads only those two.

The write path of the reference throws `NotImplementedException` for both kinds, so both are read only.

The tests cover the head of the signed kind, its signature and the depth it cannot read, a twenty four bit
picture merged with its alpha channel, the colour map of an eight bit picture, and a picture cut short; and of
the raw kind the head and the size check, the extension gate, a thirty two bit picture and an eight bit one
written out, and the clear word at twelve.
