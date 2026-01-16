import type * as acp from "@agentclientprotocol/sdk";

export type PromptImageInput = {
	base64: string;
	mimeType: string;
};

export type PromptResourceInput = {
	uri: string;
	text?: string;
	blob?: string;
	mimeType?: string;
};

export function buildPrompt(params: {
	text: string;
	images?: PromptImageInput[];
	resources?: PromptResourceInput[];
}) {
	const prompt: acp.ContentBlock[] = [{ type: "text", text: params.text }];

	if (params.images) {
		prompt.push(
			...params.images.map((img) => ({
				type: "image",
				data: img.base64,
				mimeType: img.mimeType,
			})),
		);
	}

	if (params.resources) {
		prompt.push(
			...params.resources.map((res) => ({
				type: "resource",
				resource: res.text
					? { uri: res.uri, text: res.text, mimeType: res.mimeType }
					: { uri: res.uri, blob: res.blob as string, mimeType: res.mimeType },
			})),
		);
	}

	return prompt;
}
