import type {
	IDataObject,
	IExecuteFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPairedItemData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	appsUrl,
	batchSize,
	degradedOf,
	forgetCounts,
	hint,
	inBatches,
	maskFields,
	refusal,
	requestBody,
	resultsOf,
	scanFields,
	unmaskFields,
	type Kind,
	type Operation,
} from './GenericFunctions';

const NOT_THE_API =
	"The answer is not the applications API's: is this the address of a Latet server?";

// A text of an item, on its way to the server.
interface Pending {
	index: number;
	text: string;
	kind: Kind;
	output: string; // the field its result's text goes to
}

// What a call's answer writes: the fields of each text's item in order, or forget's counts; undefined when the
// answer is not the applications API's.
function writtenOf(
	operation: Operation,
	body: unknown,
	batch: Pending[],
): IDataObject[] | { forgotten: number; unknown: number } | undefined {
	if (operation === 'forget') return forgetCounts(body);
	const results = resultsOf(body, batch.length);
	const degraded = operation === 'mask' ? degradedOf(body) : [];
	if (!results || !degraded) return undefined;
	const fields: IDataObject[] = [];
	for (const [n, result] of results.entries()) {
		const output = batch[n].output;
		const found =
			operation === 'scan'
				? scanFields(result)
				: operation === 'mask'
					? maskFields(result, output)
					: unmaskFields(result, output);
		if (!found) return undefined;
		fields.push(degraded.length > 0 ? { ...found, degraded } : found);
	}
	return fields;
}

export class Latet implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Latet',
		name: 'latet',
		icon: { light: 'file:latet.svg', dark: 'file:latet.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Find, mask and restore the personal data and secrets of texts with the applications API of a Latet server',
		defaults: {
			name: 'Latet',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		// The workflow chooses the operation (noDataExpression), never the model; an Unmask given to an agent hands it
		// the very values masking keeps from it (the README says so).
		usableAsTool: true,
		credentials: [
			{
				name: 'latetApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Forget',
						value: 'forget',
						description: "Take values out of the API key's vault for good",
						action: 'Forget values',
					},
					{
						name: 'Mask',
						value: 'mask',
						description:
							'Replace the values of a text with fakes, the same fake for the same value every time',
						action: 'Mask a text',
					},
					{
						name: 'Scan',
						value: 'scan',
						description: 'Find where the values are in a text, keeping nothing',
						action: 'Scan a text',
					},
					{
						name: 'Unmask',
						value: 'unmask',
						description: 'Put the real values back in place of the fakes of a text',
						action: 'Unmask a text',
					},
				],
				default: 'mask',
			},
			{
				displayName: 'Text Field',
				name: 'field',
				type: 'string',
				default: 'text',
				required: true,
				description: 'The field of each item that holds the text',
				displayOptions: { show: { operation: ['mask', 'scan', 'unmask'] } },
			},
			{
				displayName: 'Value Field',
				name: 'valueField',
				type: 'string',
				default: 'value',
				required: true,
				description:
					'The field of each item that holds a value to forget, written exactly as the vault keeps it',
				displayOptions: { show: { operation: ['forget'] } },
			},
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'options',
				options: [
					{
						name: 'Data',
						value: 'data',
						description: "Logs, records, a program's output",
					},
					{
						name: 'Prose',
						value: 'prose',
						description: 'Text people wrote: messages, documents',
					},
				],
				default: 'prose',
				description: 'What the texts are, which tells Latet how to read them',
				displayOptions: { show: { operation: ['mask', 'scan'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Batch Size',
						name: 'batchSize',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1000 },
						default: 1000,
						description: 'How many items go to the server in one call (1,000 at most)',
					},
					{
						displayName: 'Output Field',
						name: 'outputField',
						type: 'string',
						default: '',
						description:
							'The field the masked or restored text goes to; left empty, it replaces the text in its own field',
						displayOptions: { show: { '/operation': ['mask', 'unmask'] } },
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as Operation;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;
		const credentials = await this.getCredentials('latetApi');
		const url = appsUrl(String(credentials.url ?? ''), operation);

		const answered: Array<INodeExecutionData | undefined> = new Array(items.length);
		const pending: Pending[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const field = this.getNodeParameter(
				operation === 'forget' ? 'valueField' : 'field',
				itemIndex,
			) as string;
			const text = items[itemIndex].json[field];
			if (typeof text !== 'string') {
				const error = new NodeOperationError(
					this.getNode(),
					`Item ${itemIndex} has no text in the field "${field}"`,
					{
						itemIndex,
						description: 'The field is missing, or holds something else than a string.',
					},
				);
				if (!this.continueOnFail()) throw error;
				answered[itemIndex] = { json: { error: error.message }, pairedItem: { item: itemIndex } };
				continue;
			}
			const kind =
				operation === 'mask' || operation === 'scan'
					? (this.getNodeParameter('kind', itemIndex, 'prose') as Kind)
					: 'prose';
			const itemOptions = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
			const output = (itemOptions.outputField as string | undefined) || field;
			pending.push({ index: itemIndex, text, kind, output });
		}

		const forgotten = { forgotten: 0, unknown: 0 };
		const forgetPaired: IPairedItemData[] = [];
		for (const batch of inBatches(pending, batchSize(options.batchSize), (p) => p.kind)) {
			const first = batch[0].index;
			let failure: NodeApiError | undefined;
			let body: unknown;
			try {
				const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'latetApi', {
					method: 'POST',
					url,
					body: requestBody(
						operation,
						batch.map((p) => p.text),
						batch[0].kind,
					),
					json: true,
					returnFullResponse: true,
					ignoreHttpStatusErrors: true,
				})) as IN8nHttpFullResponse;
				body = response.body;
				if (response.statusCode !== 200) {
					failure = new NodeApiError(
						this.getNode(),
						{ error: refusal(response.statusCode, body) },
						{
							message: `Latet refused the call: ${refusal(response.statusCode, body)}`,
							description: hint(response.statusCode, response.headers?.['retry-after']),
							httpCode: String(response.statusCode),
							itemIndex: first,
						},
					);
				}
			} catch (error) {
				// Its words alone, never the error itself: n8n's error of a request holds the request, and its token.
				const why = error instanceof Error ? error.message : String(error);
				failure = new NodeApiError(this.getNode(), { error: why } as JsonObject, {
					message: 'The call to the Latet server did not go through',
					description: why,
					itemIndex: first,
				});
			}

			const written = failure ? undefined : writtenOf(operation, body, batch);
			if (!failure && written === undefined) {
				failure = new NodeApiError(
					this.getNode(),
					{ error: NOT_THE_API },
					{ message: NOT_THE_API, itemIndex: first },
				);
			}
			if (failure) {
				if (!this.continueOnFail()) throw failure;
				for (const p of batch) {
					answered[p.index] = { json: { error: failure.message }, pairedItem: { item: p.index } };
				}
				continue;
			}

			if (operation === 'forget') {
				const found = written as { forgotten: number; unknown: number };
				forgotten.forgotten += found.forgotten;
				forgotten.unknown += found.unknown;
				forgetPaired.push(...batch.map((p) => ({ item: p.index })));
				continue;
			}
			(written as IDataObject[]).forEach((fields, n) => {
				const index = batch[n].index;
				const item: INodeExecutionData = {
					json: { ...items[index].json, ...fields },
					pairedItem: { item: index },
				};
				if (items[index].binary) item.binary = items[index].binary;
				answered[index] = item;
			});
		}

		const out = answered.filter((item): item is INodeExecutionData => item !== undefined);
		if (operation === 'forget' && forgetPaired.length > 0) {
			out.push({ json: { ...forgotten }, pairedItem: forgetPaired });
		}
		return [out];
	}
}
