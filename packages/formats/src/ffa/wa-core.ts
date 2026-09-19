// The table the two walks of the FFA System sounds share.
//
// Reference: GARbro "ArcFormats/Ffa/AudioWA1.cs", `Wa1Reader.SampleTable`, which the walk of the second kind
// of the engine, "ArcFormats/Ffa/AudioWA2.cs", takes as well. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** `Wa1Reader.SampleTable`, how far the step of a walk climbs for every place of a code. */
export const WA_SAMPLE_TABLE = new Uint16Array([
	0x39, 0x39, 0x39, 0x39, 0x4d, 0x66, 0x80, 0x99, 0x39, 0x39, 0x39, 0x39, 0x4d,
	0x66, 0x80, 0x99,
]);
