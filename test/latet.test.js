// The Latet node and its credentials, as n8n runs them, against a stand-in for n8n's execute context whose
// httpRequestWithAuthentication records each call and answers as a Latet server would. Runs on the build (dist).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Latet } = require('../dist/nodes/Latet/Latet.node.js');
const { LatetApi } = require('../dist/credentials/LatetApi.credentials.js');

const SERVER = 'https://latet.example.com';
const TOKEN = 'latet_key_' + 'a'.repeat(43);

// A run of the node: the items it is given, its parameters, and how the server answers each call (`answer(body)` gives
// `{statusCode, body, headers}`, or throws as a connection that failed). Gives the output and the calls made.
async function run({
	items,
	params,
	answer,
	credentials = { url: SERVER, token: TOKEN },
	continueOnFail = false,
}) {
	const calls = [];
	const context = {
		getInputData: () => items,
		getNodeParameter: (name, index, fallback) => {
			const value = params[name];
			if (typeof value === 'function') return value(index);
			return value === undefined ? fallback : value;
		},
		getCredentials: async (name) => {
			assert.equal(name, 'latetApi');
			return credentials;
		},
		getNode: () => ({
			id: 'latet',
			name: 'Latet',
			type: 'n8n-nodes-latet.latet',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async function (type, options) {
				calls.push({ type, options });
				return answer(options.body, options);
			},
		},
	};
	const output = await new Latet().execute.call(context);
	return { output: output[0], calls };
}

function texts(n, field = 'text') {
	return Array.from({ length: n }, (_, i) => ({ json: { id: i, [field]: `text ${i}` } }));
}

const ok = (body) => ({ statusCode: 200, headers: {}, body });

describe('the credentials', () => {
	const credentials = new LatetApi();

	it('are the server address and a token kept as a password', () => {
		assert.equal(credentials.name, 'latetApi');
		const url = credentials.properties.find((p) => p.name === 'url');
		const token = credentials.properties.find((p) => p.name === 'token');
		assert.equal(url.type, 'string');
		assert.equal(token.type, 'string');
		assert.equal(token.typeOptions.password, true);
	});

	it('send the token as a bearer token', () => {
		const header = credentials.authenticate.properties.headers.Authorization;
		// n8n resolves the expression with the credentials' values
		const resolved = header.replace(/^=/, '').replace('{{$credentials.token}}', TOKEN);
		assert.equal(resolved, `Bearer ${TOKEN}`);
		assert.equal(credentials.authenticate.type, 'generic');
	});

	it('are tested with a scan of one text', () => {
		const { request } = credentials.test;
		assert.equal(request.method, 'POST');
		assert.equal(request.baseURL, '={{$credentials.url}}');
		assert.equal(request.url, '/_latet/apps/v1/scan');
		assert.deepEqual(request.body, { texts: ['latet'] });
	});
});

describe('the calls', () => {
	it('scan sends the texts and their kind to the scan route with the credentials', async () => {
		const { calls } = await run({
			items: texts(2),
			params: { operation: 'scan', field: 'text', kind: 'data' },
			answer: (body) => ok({ results: body.texts.map(() => ({ findings: [], counts: {} })) }),
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0].type, 'latetApi');
		assert.equal(calls[0].options.method, 'POST');
		assert.equal(calls[0].options.url, `${SERVER}/_latet/apps/v1/scan`);
		assert.deepEqual(calls[0].options.body, { texts: ['text 0', 'text 1'], kind: 'data' });
		assert.equal(calls[0].options.json, true);
	});

	it('mask sends prose by default; unmask sends no kind', async () => {
		const masked = await run({
			items: texts(1),
			params: { operation: 'mask', field: 'text' },
			answer: (body) =>
				ok({ results: body.texts.map((t) => ({ text: t, replacements: [], counts: {} })) }),
		});
		assert.equal(masked.calls[0].options.url, `${SERVER}/_latet/apps/v1/mask`);
		assert.deepEqual(masked.calls[0].options.body, { texts: ['text 0'], kind: 'prose' });
		const unmasked = await run({
			items: texts(1),
			params: { operation: 'unmask', field: 'text' },
			answer: (body) => ok({ results: body.texts.map((t) => ({ text: t, restored: 0 })) }),
		});
		assert.equal(unmasked.calls[0].options.url, `${SERVER}/_latet/apps/v1/unmask`);
		assert.deepEqual(unmasked.calls[0].options.body, { texts: ['text 0'] });
	});

	it('forget sends the values of the field', async () => {
		const { calls } = await run({
			items: [
				{ json: { value: 'mario.rossi@acme.it' } },
				{ json: { value: 'IT60X0542811101000000123456' } },
			],
			params: { operation: 'forget', valueField: 'value' },
			answer: () => ok({ forgotten: 1, unknown: 1 }),
		});
		assert.equal(calls[0].options.url, `${SERVER}/_latet/apps/v1/forget`);
		assert.deepEqual(calls[0].options.body, {
			values: ['mario.rossi@acme.it', 'IT60X0542811101000000123456'],
		});
	});

	it("reads the server's address with or without a slash at its end", async () => {
		const { calls } = await run({
			items: texts(1),
			params: { operation: 'scan', field: 'text' },
			credentials: { url: `${SERVER}/latet/`, token: TOKEN },
			answer: () => ok({ results: [{ findings: [], counts: {} }] }),
		});
		assert.equal(calls[0].options.url, `${SERVER}/latet/_latet/apps/v1/scan`);
	});

	it('sends 2,500 items in 3 calls of 1,000, 1,000 and 500, each result back on its item', async () => {
		const { output, calls } = await run({
			items: texts(2500),
			params: { operation: 'unmask', field: 'text' },
			answer: (body) =>
				ok({ results: body.texts.map((t) => ({ text: t.toUpperCase(), restored: 1 })) }),
		});
		assert.deepEqual(
			calls.map((c) => c.options.body.texts.length),
			[1000, 1000, 500],
		);
		assert.equal(calls[1].options.body.texts[0], 'text 1000');
		assert.equal(output.length, 2500);
		assert.equal(output[1500].json.text, 'TEXT 1500');
		assert.equal(output[1500].json.id, 1500);
		assert.deepEqual(output[1500].pairedItem, { item: 1500 });
	});

	it('takes a smaller batch size, and never more than 1,000', async () => {
		const answer = (body) => ok({ results: body.texts.map(() => ({ findings: [], counts: {} })) });
		const small = await run({
			items: texts(250),
			params: { operation: 'scan', field: 'text', options: { batchSize: 100 } },
			answer,
		});
		assert.deepEqual(
			small.calls.map((c) => c.options.body.texts.length),
			[100, 100, 50],
		);
		const large = await run({
			items: texts(1500),
			params: { operation: 'scan', field: 'text', options: { batchSize: 5000 } },
			answer,
		});
		assert.deepEqual(
			large.calls.map((c) => c.options.body.texts.length),
			[1000, 500],
		);
	});

	it('sends texts of another kind in a call of their own', async () => {
		const { calls } = await run({
			items: texts(4),
			params: { operation: 'mask', field: 'text', kind: (i) => (i < 2 ? 'prose' : 'data') },
			answer: (body) =>
				ok({ results: body.texts.map((t) => ({ text: t, replacements: [], counts: {} })) }),
		});
		assert.deepEqual(
			calls.map((c) => [c.options.body.kind, c.options.body.texts.length]),
			[
				['prose', 2],
				['data', 2],
			],
		);
	});
});

describe('the answers', () => {
	it('scan writes findings and counts to the item, its text unchanged', async () => {
		const findings = [{ type: 'EMAIL', class: 'pii', start: 9, end: 28 }];
		const { output } = await run({
			items: [{ json: { id: 7, text: 'write to mario.rossi@acme.it' } }],
			params: { operation: 'scan', field: 'text' },
			answer: () => ok({ results: [{ findings, counts: { EMAIL: 1 } }] }),
		});
		assert.deepEqual(output[0].json, {
			id: 7,
			text: 'write to mario.rossi@acme.it',
			findings,
			counts: { EMAIL: 1 },
		});
		assert.deepEqual(output[0].pairedItem, { item: 0 });
	});

	it('mask puts the masked text in the field, with replacements, counts, blocked and degraded', async () => {
		const replacements = [{ type: 'EMAIL', class: 'pii', start: 9, end: 42 }];
		const blocked = 'the local reviewer stopped this text';
		const { output } = await run({
			items: [
				{ json: { id: 1, body: 'write to mario.rossi@acme.it' } },
				{ json: { id: 2, body: 'something the reviewer stops' } },
			],
			params: { operation: 'mask', field: 'body' },
			answer: () =>
				ok({
					results: [
						{
							text: 'write to tommaso.gallo@margie-6e5a.example',
							replacements,
							counts: { EMAIL: 1 },
						},
						{ blocked },
					],
					degraded: ['llm-review'],
				}),
		});
		assert.deepEqual(output[0].json, {
			id: 1,
			body: 'write to tommaso.gallo@margie-6e5a.example',
			replacements,
			counts: { EMAIL: 1 },
			degraded: ['llm-review'],
		});
		// a text Latet did not answer leaves the item without its text in clear
		assert.deepEqual(output[1].json, { id: 2, body: null, blocked, degraded: ['llm-review'] });
	});

	it('mask says nothing of degraded when the server did not', async () => {
		const { output } = await run({
			items: texts(1),
			params: { operation: 'mask', field: 'text' },
			answer: () => ok({ results: [{ text: 'text 0', replacements: [], counts: {} }] }),
		});
		assert.equal('degraded' in output[0].json, false);
	});

	it('unmask puts the restored text and how many values it restored', async () => {
		const { output } = await run({
			items: [{ json: { text: 'write to tommaso.gallo@margie-6e5a.example' } }],
			params: { operation: 'unmask', field: 'text' },
			answer: () => ok({ results: [{ text: 'write to mario.rossi@acme.it', restored: 1 }] }),
		});
		assert.deepEqual(output[0].json, { text: 'write to mario.rossi@acme.it', restored: 1 });
	});

	it('writes the text to another field when the options say so, the first left as it was', async () => {
		const { output } = await run({
			items: [{ json: { text: 'write to tommaso.gallo@margie-6e5a.example' } }],
			params: { operation: 'unmask', field: 'text', options: { outputField: 'restoredText' } },
			answer: () => ok({ results: [{ text: 'write to mario.rossi@acme.it', restored: 1 }] }),
		});
		assert.deepEqual(output[0].json, {
			text: 'write to tommaso.gallo@margie-6e5a.example',
			restoredText: 'write to mario.rossi@acme.it',
			restored: 1,
		});
	});

	it('keeps the binary data of an item', async () => {
		const binary = { data: { data: 'aGVsbG8=', mimeType: 'text/plain' } };
		const { output } = await run({
			items: [{ json: { text: 'hello' }, binary }],
			params: { operation: 'scan', field: 'text' },
			answer: () => ok({ results: [{ findings: [], counts: {} }] }),
		});
		assert.deepEqual(output[0].binary, binary);
	});

	it('forget gives one item with the values forgotten and unknown, added up over its calls', async () => {
		const items = Array.from({ length: 1200 }, (_, i) => ({ json: { value: `value ${i}` } }));
		const { output, calls } = await run({
			items,
			params: { operation: 'forget', valueField: 'value' },
			answer: (body) => ok({ forgotten: body.values.length - 1, unknown: 1 }),
		});
		assert.equal(calls.length, 2);
		assert.equal(output.length, 1);
		assert.deepEqual(output[0].json, { forgotten: 1198, unknown: 2 });
		assert.equal(output[0].pairedItem.length, 1200);
		assert.deepEqual(output[0].pairedItem[1199], { item: 1199 });
	});
});

describe('the errors', () => {
	it("a refusal is an error with the server's words and its status, never the token", async () => {
		await assert.rejects(
			run({
				items: texts(1),
				params: { operation: 'unmask', field: 'text' },
				answer: () => ({
					statusCode: 403,
					headers: {},
					body: { error: 'this token lacks the unmask permission' },
				}),
			}),
			(error) => {
				assert.match(error.message, /this token lacks the unmask permission/);
				assert.equal(error.httpCode, '403');
				assert.doesNotMatch(JSON.stringify(error), new RegExp(TOKEN));
				return true;
			},
		);
	});

	it('a 429 says how long the server asked to wait', async () => {
		await assert.rejects(
			run({
				items: texts(1),
				params: { operation: 'mask', field: 'text' },
				answer: () => ({
					statusCode: 429,
					headers: { 'retry-after': '7' },
					body: { error: 'latet: too many requests' },
				}),
			}),
			(error) => {
				assert.equal(error.httpCode, '429');
				assert.match(error.description, /7 s/);
				return true;
			},
		);
	});

	it("an answer that is not the applications API's is an error", async () => {
		for (const body of [
			'<html>a proxy</html>',
			{ results: [] },
			{ results: [{ text: 1, restored: 0 }] },
			{ results: [{ text: 'x' }] },
		]) {
			await assert.rejects(
				run({
					items: texts(1),
					params: { operation: 'unmask', field: 'text' },
					answer: () => ok(body),
				}),
				/not the applications API's/,
			);
		}
	});

	it('a call that does not go through is an error that does not quote the request', async () => {
		await assert.rejects(
			run({
				items: texts(1),
				params: { operation: 'scan', field: 'text' },
				answer: () => {
					const error = new Error('connect ECONNREFUSED 10.0.0.1:443');
					error.config = { headers: { Authorization: `Bearer ${TOKEN}` } };
					throw error;
				},
			}),
			(error) => {
				assert.match(error.message, /did not go through/);
				assert.doesNotMatch(JSON.stringify(error), new RegExp(TOKEN));
				return true;
			},
		);
	});

	it('an item without a text in the field is an error naming the item', async () => {
		await assert.rejects(
			run({
				items: [{ json: { text: 'a' } }, { json: { other: 'b' } }],
				params: { operation: 'scan', field: 'text' },
				answer: () => ok({ results: [{ findings: [], counts: {} }] }),
			}),
			(error) => {
				assert.match(error.message, /"text"/);
				assert.equal(error.context.itemIndex, 1);
				return true;
			},
		);
	});

	it('with Continue On Fail, an item without a text gets an error and the others are sent', async () => {
		const { output, calls } = await run({
			items: [{ json: { text: 'a' } }, { json: { text: 3 } }, { json: { text: 'c' } }],
			params: { operation: 'scan', field: 'text' },
			continueOnFail: true,
			answer: (body) => ok({ results: body.texts.map(() => ({ findings: [], counts: {} })) }),
		});
		assert.deepEqual(calls[0].options.body.texts, ['a', 'c']);
		assert.equal(output.length, 3);
		assert.match(output[1].json.error, /"text"/);
		assert.deepEqual(output[1].pairedItem, { item: 1 });
		assert.deepEqual(output[2].json.findings, []);
	});

	it('with Continue On Fail, the items of a refused call get its error and no text in clear', async () => {
		const { output } = await run({
			items: texts(1500),
			params: { operation: 'mask', field: 'text' },
			continueOnFail: true,
			answer: (body) =>
				body.texts[0] === 'text 0'
					? { statusCode: 507, headers: {}, body: { error: "this API key's vault is full" } }
					: ok({ results: body.texts.map((t) => ({ text: t, replacements: [], counts: {} })) }),
		});
		assert.equal(output.length, 1500);
		assert.deepEqual(Object.keys(output[0].json), ['error']);
		assert.match(output[0].json.error, /vault is full/);
		assert.deepEqual(output[999].pairedItem, { item: 999 });
		assert.equal(output[1000].json.text, 'text 1000');
	});
});
