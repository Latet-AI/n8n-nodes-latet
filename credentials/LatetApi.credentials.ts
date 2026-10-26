import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class LatetApi implements ICredentialType {
	name = 'latetApi';

	displayName = 'Latet API';

	icon: Icon = {
		light: 'file:../nodes/Latet/latet.svg',
		dark: 'file:../nodes/Latet/latet.dark.svg',
	};

	documentationUrl = 'https://docs.latet.ai/reference/apps-api/';

	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'url',
			type: 'string',
			default: '',
			placeholder: 'https://latet.example.com',
			description: 'The address of your Latet server, as its administrator gives it',
			required: true,
		},
		{
			displayName: 'Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				"An API key's token (latet_key_...) with the permission of each operation you use: scan, mask, unmask or forget",
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	// A scan of one word: it keeps nothing, and answers 200 for a token with the scan permission (mask brings it).
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.url}}',
			url: '/_latet/apps/v1/scan',
			method: 'POST',
			body: { texts: ['latet'] },
		},
	};
}
