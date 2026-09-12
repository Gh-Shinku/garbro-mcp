export type GarbroErrorCode =
	| "INVALID_ARCHIVE"
	| "UNSUPPORTED_FEATURE"
	| "ENTRY_NOT_FOUND"
	| "UNSAFE_PATH"
	| "OUTPUT_EXISTS"
	| "IO_ERROR";

export class GarbroError extends Error {
	readonly code: GarbroErrorCode;
	readonly details: Record<string, unknown> | undefined;

	constructor(
		code: GarbroErrorCode,
		message: string,
		options: { cause?: unknown; details?: Record<string, unknown> } = {},
	) {
		super(
			message,
			options.cause === undefined ? undefined : { cause: options.cause },
		);
		this.name = "GarbroError";
		this.code = code;
		this.details = options.details;
	}
}

export function asGarbroError(error: unknown): GarbroError {
	if (error instanceof GarbroError) return error;
	const message = error instanceof Error ? error.message : String(error);
	return new GarbroError("IO_ERROR", message, { cause: error });
}
