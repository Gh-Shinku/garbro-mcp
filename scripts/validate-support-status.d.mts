export function validateSupportStatus(status: unknown, taxonomy: unknown): void;

export function validateSupportStatusFiles(
	root?: string,
): Promise<{ records: number; migrated: number }>;
