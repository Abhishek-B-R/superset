import { z } from "zod";

/**
 * Minimal zod views over the Agent Client Protocol (agent-client-protocol
 * v2.x) messages the chat runtime consumes. Loose objects everywhere so the
 * adapter tolerates fields newer agents add.
 */

export const acpTextContentSchema = z.looseObject({
	type: z.literal("text"),
	text: z.string(),
});

export const acpContentBlockSchema = z.looseObject({
	type: z.string(),
	text: z.string().optional(),
});
export type AcpContentBlock = z.infer<typeof acpContentBlockSchema>;

export const acpInitializeResponseSchema = z.looseObject({
	protocolVersion: z.number().optional(),
	agentCapabilities: z.unknown().optional(),
	authMethods: z.array(z.unknown()).optional(),
});

export const acpNewSessionResponseSchema = z.looseObject({
	sessionId: z.string().min(1),
	modes: z
		.looseObject({
			currentModeId: z.string().optional(),
			availableModes: z
				.array(z.looseObject({ id: z.string(), name: z.string() }))
				.optional(),
		})
		.optional(),
});

export const acpPromptResponseSchema = z.looseObject({
	stopReason: z.string(),
});

// --- session/update variants -------------------------------------------------

const acpToolCallContentSchema = z.looseObject({
	type: z.string(),
	content: acpContentBlockSchema.optional(),
	path: z.string().optional(),
	oldText: z.string().nullable().optional(),
	newText: z.string().optional(),
	terminalId: z.string().optional(),
});
export type AcpToolCallContent = z.infer<typeof acpToolCallContentSchema>;

const acpLocationSchema = z.looseObject({
	path: z.string(),
	line: z.number().int().optional(),
});

export const acpToolCallUpdateSchema = z.looseObject({
	toolCallId: z.string().min(1),
	title: z.string().optional(),
	kind: z.string().optional(),
	status: z.string().optional(),
	content: z.array(acpToolCallContentSchema).optional(),
	locations: z.array(acpLocationSchema).optional(),
	rawInput: z.unknown().optional(),
	rawOutput: z.unknown().optional(),
});
export type AcpToolCallUpdate = z.infer<typeof acpToolCallUpdateSchema>;

export const acpPlanSchema = z.looseObject({
	entries: z.array(
		z.looseObject({
			content: z.string(),
			priority: z.string().optional(),
			status: z.string(),
		}),
	),
});

const messageChunkSchema = z.looseObject({
	content: acpContentBlockSchema,
});

// Only the discriminator is validated here; each variant carries different
// shapes for `content` (object for message chunks, array for tool calls), so
// the per-variant handlers parse their own fields from the raw update.
export const acpSessionUpdateSchema = z.looseObject({
	sessionUpdate: z.string(),
	currentModeId: z.string().optional(),
});

export const acpSessionNotificationSchema = z.looseObject({
	sessionId: z.string().min(1),
	update: z.looseObject({ sessionUpdate: z.string() }),
});

export const acpAgentMessageChunkSchema = messageChunkSchema;
export const acpUserMessageChunkSchema = messageChunkSchema;
export const acpAgentThoughtChunkSchema = messageChunkSchema;

// --- session/request_permission ----------------------------------------------

export const acpPermissionOptionSchema = z.looseObject({
	optionId: z.string().min(1),
	name: z.string(),
	kind: z.string().optional(),
});
export type AcpPermissionOption = z.infer<typeof acpPermissionOptionSchema>;

export const acpRequestPermissionParamsSchema = z.looseObject({
	sessionId: z.string().min(1),
	toolCall: acpToolCallUpdateSchema.partial({ toolCallId: true }).optional(),
	options: z.array(acpPermissionOptionSchema),
});
export type AcpRequestPermissionParams = z.infer<
	typeof acpRequestPermissionParamsSchema
>;
