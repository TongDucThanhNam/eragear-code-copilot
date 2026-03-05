export type StoredContentBlock =
  | { type: "text"; text: string; annotations?: unknown }
  | {
      type: "image";
      data: string;
      mimeType: string;
      uri?: string;
      annotations?: unknown;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: unknown;
      uri?: string;
      caption?: string;
    }
  | {
      type: "resource";
      resource: {
        uri: string;
        text?: string;
        blob?: string;
        mimeType?: string;
      };
      annotations?: unknown;
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string | null;
      title?: string | null;
      description?: string | null;
      size?: number | null;
      annotations?: unknown;
    };

export type ImageBlock = Extract<StoredContentBlock, { type: "image" }>;
export type AudioBlock = Extract<StoredContentBlock, { type: "audio" }>;
export type ResourceBlock = Extract<StoredContentBlock, { type: "resource" }>;
export type ResourceLinkBlock = Extract<
  StoredContentBlock,
  { type: "resource_link" }
>;
