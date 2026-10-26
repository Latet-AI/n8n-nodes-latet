import type { IDataObject } from 'n8n-workflow';

// The applications API of a Latet server: its path, and how many texts (or values to forget) one call takes at most.
export const APPS_API = '/_latet/apps/v1';
export const MOST_TEXTS = 1000;
const MOST_WORDS = 500; // characters kept of the server's words in an error

export type Operation = 'forget' | 'mask' | 'scan' | 'unmask';
export type Kind = 'data' | 'prose';

/** The address of an operation on the server whose address the credentials give, with or without a final slash. */
export function appsUrl(server: string, operation: Operation): string {
	return `${server.trim().replace(/\/+$/, '')}${APPS_API}/${operation}`;
}

/** The body of a call: the texts and their kind for scan and mask, the texts alone for unmask, values for forget. */
export function requestBody(operation: Operation, texts: string[], kind: Kind): IDataObject {
	if (operation === 'forget') return { values: texts };
	if (operation === 'unmask') return { texts };
	return { texts, kind };
}

/** `entries` in runs of at most `size` consecutive entries of the same key (one call each: a call has one kind). */
export function inBatches<T>(entries: T[], size: number, key: (entry: T) => string): T[][] {
	const batches: T[][] = [];
	let batch: T[] = [];
	for (const entry of entries) {
		if (batch.length > 0 && (batch.length >= size || key(batch[0]) !== key(entry))) {
			batches.push(batch);
			batch = [];
		}
		batch.push(entry);
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

/** The batch size the options ask for, between 1 and the most a call takes. */
export function batchSize(asked: unknown): number {
	const size = typeof asked === 'number' && Number.isFinite(asked) ? Math.floor(asked) : MOST_TEXTS;
	return Math.min(Math.max(size, 1), MOST_TEXTS);
}

function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// The places of the values found or replaced (`type`, `class`, `start`, `end`), or undefined when it is not a list of them.
function places(value: unknown): IDataObject[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const found: IDataObject[] = [];
	for (const place of value) {
		if (!isObject(place)) return undefined;
		const { type, start, end } = place;
		const eclass = place.class;
		if (
			typeof type !== 'string' ||
			typeof eclass !== 'string' ||
			!isCount(start) ||
			!isCount(end)
		) {
			return undefined;
		}
		found.push({ type, class: eclass, start, end });
	}
	return found;
}

function counts(value: unknown): IDataObject | undefined {
	if (!isObject(value)) return undefined;
	return Object.values(value).every(isCount) ? value : undefined;
}

/** The `count` results of an answer, or undefined when it is not the applications API's. */
export function resultsOf(body: unknown, count: number): IDataObject[] | undefined {
	if (!isObject(body) || !Array.isArray(body.results) || body.results.length !== count)
		return undefined;
	return body.results.every(isObject) ? (body.results as IDataObject[]) : undefined;
}

/** What a scan's result writes to its item: where the values are in its text, and how many of each type. */
export function scanFields(result: IDataObject): IDataObject | undefined {
	const findings = places(result.findings);
	const found = counts(result.counts);
	return findings && found ? { findings, counts: found } : undefined;
}

/**
 * What a mask's result writes to its item: the masked text in `field`, where its fakes are and how many of each type;
 * for a text Latet did not answer, `blocked` and no text (null in `field`, so that the text in clear goes no further).
 */
export function maskFields(result: IDataObject, field: string): IDataObject | undefined {
	if ('blocked' in result) {
		return typeof result.blocked === 'string'
			? { [field]: null, blocked: result.blocked }
			: undefined;
	}
	const replacements = places(result.replacements);
	const replaced = counts(result.counts);
	if (typeof result.text !== 'string' || !replacements || !replaced) return undefined;
	return { [field]: result.text, replacements, counts: replaced };
}

/** What an unmask's result writes to its item: the restored text in `field`, and how many values it restored. */
export function unmaskFields(result: IDataObject, field: string): IDataObject | undefined {
	if (typeof result.text !== 'string' || !isCount(result.restored)) return undefined;
	return { [field]: result.text, restored: result.restored };
}

/** What a mask call says ran weaker on it (`degraded`): a list, empty when it said nothing; undefined when malformed. */
export function degradedOf(body: unknown): string[] | undefined {
	if (!isObject(body)) return undefined;
	const degraded = body.degraded ?? [];
	if (!Array.isArray(degraded) || !degraded.every((name) => typeof name === 'string'))
		return undefined;
	return degraded as string[];
}

/** How many values a forget call forgot and how many the vault did not know, or undefined when malformed. */
export function forgetCounts(body: unknown): { forgotten: number; unknown: number } | undefined {
	if (!isObject(body) || !isCount(body.forgotten) || !isCount(body.unknown)) return undefined;
	return { forgotten: body.forgotten, unknown: body.unknown };
}

/** The server's words for a refusal (`error`), printable and short; `HTTP <status>` when it gave none. */
export function refusal(statusCode: number, body: unknown): string {
	const said = isObject(body) ? body.error : undefined;
	const words = typeof said === 'string' && said.trim() ? said : `HTTP ${statusCode}`;
	return Array.from(words)
		.filter((char) => char >= ' ' && char !== '\u007f')
		.join('')
		.slice(0, MOST_WORDS);
}

/** What to do about a refusal, by its status. */
export function hint(statusCode: number, retryAfter: unknown): string | undefined {
	const wait =
		typeof retryAfter === 'string' && /^\d+$/.test(retryAfter.trim())
			? retryAfter.trim()
			: undefined;
	switch (statusCode) {
		case 401:
			return 'The server does not know the token (revoked, rotated or mistyped): check the Latet API credentials.';
		case 403:
			return 'Use a token with the permission of this operation: an administrator makes one with latet server keys add-token.';
		case 413:
		case 422:
			return 'Send fewer texts in a call: lower Batch Size in the options.';
		case 429:
		case 503:
			return `Wait${wait ? ` ${wait} s, as the server asked,` : ''} then try again: the node's Retry On Fail setting does it for you.`;
		case 507:
			return "The API key's vault is full: an administrator raises its limit with latet server keys limit.";
		default:
			return undefined;
	}
}
