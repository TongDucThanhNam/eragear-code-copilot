export function fileUriToPath(uri: string) {
	if (uri.startsWith("file://")) {
		return decodeURIComponent(uri.replace("file://", ""));
	}
	return uri;
}
