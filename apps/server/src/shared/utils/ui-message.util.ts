import {
  appendContentBlock as appendContentBlockImpl,
  appendReasoningBlock as appendReasoningBlockImpl,
  appendReasoningPart as appendReasoningPartImpl,
  appendTextPart as appendTextPartImpl,
  buildAssistantMessageFromBlocks as buildAssistantMessageFromBlocksImpl,
  buildUserMessageFromBlocks as buildUserMessageFromBlocksImpl,
  contentBlockToParts as contentBlockToPartsImpl,
} from "./ui-message/content";
import { buildProviderMetadataFromMeta as buildProviderMetadataFromMetaImpl } from "./ui-message/metadata";
import {
  createUiMessageState as createUiMessageStateImpl,
  finalizeStreamingParts as finalizeStreamingPartsImpl,
  getOrCreateAssistantMessage as getOrCreateAssistantMessageImpl,
  getOrCreateUserMessage as getOrCreateUserMessageImpl,
  upsertToolLocationsPart as upsertToolLocationsPartImpl,
  upsertToolPart as upsertToolPartImpl,
} from "./ui-message/state";
import {
  buildPlanToolPart as buildPlanToolPartImpl,
  buildToolApprovalPart as buildToolApprovalPartImpl,
  buildToolApprovalResponsePart as buildToolApprovalResponsePartImpl,
  buildToolPartForUpdate as buildToolPartForUpdateImpl,
  buildToolPartFromCall as buildToolPartFromCallImpl,
  getPlanToolCallId as getPlanToolCallIdImpl,
  getToolNameFromCall as getToolNameFromCallImpl,
} from "./ui-message/tool";

export const appendContentBlock = appendContentBlockImpl;
export const appendReasoningBlock = appendReasoningBlockImpl;
export const appendReasoningPart = appendReasoningPartImpl;
export const appendTextPart = appendTextPartImpl;
export const buildAssistantMessageFromBlocks =
  buildAssistantMessageFromBlocksImpl;
export const buildProviderMetadataFromMeta = buildProviderMetadataFromMetaImpl;
export const buildToolApprovalPart = buildToolApprovalPartImpl;
export const buildToolApprovalResponsePart = buildToolApprovalResponsePartImpl;
export const buildToolPartForUpdate = buildToolPartForUpdateImpl;
export const buildToolPartFromCall = buildToolPartFromCallImpl;
export const buildUserMessageFromBlocks = buildUserMessageFromBlocksImpl;
export const contentBlockToParts = contentBlockToPartsImpl;
export const createUiMessageState = createUiMessageStateImpl;
export const finalizeStreamingParts = finalizeStreamingPartsImpl;
export const getOrCreateAssistantMessage = getOrCreateAssistantMessageImpl;
export const getOrCreateUserMessage = getOrCreateUserMessageImpl;
export const getPlanToolCallId = getPlanToolCallIdImpl;
export const getToolNameFromCall = getToolNameFromCallImpl;
export const upsertToolLocationsPart = upsertToolLocationsPartImpl;
export const upsertToolPart = upsertToolPartImpl;
export const buildPlanToolPart = buildPlanToolPartImpl;
