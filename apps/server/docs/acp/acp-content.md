# Content

> Understanding content blocks in the Agent Client Protocol

Content blocks represent displayable information that flows through the Agent Client Protocol. They provide a structured way to handle various types of user-facing content—whether it's text from language models, images for analysis, or embedded resources for context.

Content blocks appear in:

* User prompts sent via [`session/prompt`](./acp-prompt-turn#1-user-message)
* Language model output streamed through [`session/update`](./acp-prompt-turn#3-agent-reports-output) notifications
* Progress updates and results from [tool calls](./acp-tool-call)

## Content Types

The Agent Client Protocol uses the same `ContentBlock` structure as the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/specification/2025-06-18/schema#contentblock).

This design choice enables Agents to seamlessly forward content from MCP tool outputs without transformation.

### Text Content

Plain text messages form the foundation of most interactions.

```json
{
  "type": "text",
  "text": "What's the weather like today?"
}
```

All Agents **MUST** support text content blocks when included in prompts.

- **`text`** (required `string`): The text content to display
- **`annotations`** (`Annotations`): Optional metadata about how the content should be used or displayed. [Learn more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).

### Image Content *

Images can be included for visual context or analysis.

```json
{
  "type": "image",
  "mimeType": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
}
```

\* Requires the `image` [prompt capability](./acp-initialization#prompt-capabilities) when included in prompts.

- **`data`** (required `string`): Base64-encoded image data
- **`mimeType`** (required `string`): The MIME type of the image (e.g., "image/png", "image/jpeg")
- **`uri`** (`string`): Optional URI reference for the image source
- **`annotations`** (`Annotations`): Optional metadata about how the content should be used or displayed. [Learn more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).

### Audio Content *

Audio data for transcription or analysis.

```json
{
  "type": "audio",
  "mimeType": "audio/wav",
  "data": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB..."
}
```

\* Requires the `audio` [prompt capability](./acp-initialization#prompt-capabilities) when included in prompts.

- **`data`** (required `string`): Base64-encoded audio data
- **`mimeType`** (required `string`): The MIME type of the audio (e.g., "audio/wav", "audio/mp3")
- **`annotations`** (`Annotations`): Optional metadata about how the content should be used or displayed. [Learn more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).

### Embedded Resource *

Complete resource contents embedded directly in the message.

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///home/user/script.py",
    "mimeType": "text/x-python",
    "text": "def hello():\n    print('Hello, world!')"
  }
}
```

This is the preferred way to include context in prompts, such as when using @-mentions to reference files or other resources.

By embedding the content directly in the request, Clients can include context from sources that the Agent may not have direct access to.

\* Requires the `embeddedContext` [prompt capability](./acp-initialization#prompt-capabilities) when included in prompts.

- **`resource`** (required `EmbeddedResourceResource`): The embedded resource contents, which can be either:

  **Text Resource:**
  - **`uri`** (required `string`): The URI identifying the resource
  - **`text`** (required `string`): The text content of the resource
  - **`mimeType`** (`string`): Optional MIME type of the text content

  **Blob Resource:**
  - **`uri`** (required `string`): The URI identifying the resource
  - **`blob`** (required `string`): Base64-encoded binary data
  - **`mimeType`** (`string`): Optional MIME type of the blob

- **`annotations`** (`Annotations`): Optional metadata about how the content should be used or displayed. [Learn more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).

### Resource Link

References to resources that the Agent can access.

```json
{
  "type": "resource_link",
  "uri": "file:///home/user/document.pdf",
  "name": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000
}
```

- **`uri`** (required `string`): The URI of the resource
- **`name`** (required `string`): A human-readable name for the resource
- **`mimeType`** (`string`): The MIME type of the resource
- **`title`** (`string`): Optional display title for the resource
- **`description`** (`string`): Optional description of the resource contents
- **`size`** (`integer`): Optional size of the resource in bytes
- **`annotations`** (`Annotations`): Optional metadata about how the content should be used or displayed. [Learn more](https://modelcontextprotocol.io/specification/2025-06-18/server/resources#annotations).

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://agentclientprotocol.com/llms.txt