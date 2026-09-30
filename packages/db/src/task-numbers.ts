import { and, asc, eq, like, sql } from "drizzle-orm";
import type { dbWs } from "./client";
import { organizations, taskSequences, tasks, teams } from "./schema";

type DbWsTransaction = Parameters<Parameters<typeof dbWs.transaction>[0]>[0];

const MAX_KEY_LENGTH = 5;
const FALLBACK_KEY = "TASK";

export function deriveTaskKey(name: string): string {
	const firstWord =
		name
			.trim()
			.split(/\s+/)[0]
			?.replace(/['’]s$/i, "") ?? "";
	const letters = firstWord.normalize("NFD").replace(/[^A-Za-z]/g, "");
	return letters.slice(0, MAX_KEY_LENGTH).toUpperCase() || FALLBACK_KEY;
}

async function advance(
	tx: DbWsTransaction,
	organizationId: string,
	count: number,
) {
	const [sequence] = await tx
		.update(taskSequences)
		.set({ lastNumber: sql`${taskSequences.lastNumber} + ${count}` })
		.where(eq(taskSequences.organizationId, organizationId))
		.returning({
			teamId: taskSequences.teamId,
			key: taskSequences.key,
			lastNumber: taskSequences.lastNumber,
		});
	return sequence;
}

async function defaultTeamId(
	tx: DbWsTransaction,
	organization: { id: string; name: string; slug: string },
) {
	const oldest = () =>
		tx
			.select({ id: teams.id })
			.from(teams)
			.where(eq(teams.organizationId, organization.id))
			.orderBy(asc(teams.createdAt))
			.limit(1);

	const [existing] = await oldest();
	if (existing) return existing.id;

	await tx
		.insert(teams)
		.values({
			organizationId: organization.id,
			name: organization.name,
			slug: organization.slug,
		})
		.onConflictDoNothing();
	const [created] = await oldest();
	if (!created) throw new Error(`No team for ${organization.id}`);
	return created.id;
}

/** Starts above the highest `<key>-<n>` slug the organization already has. */
async function createSequence(tx: DbWsTransaction, organizationId: string) {
	const [organization] = await tx
		.select({
			id: organizations.id,
			name: organizations.name,
			slug: organizations.slug,
		})
		.from(organizations)
		.where(eq(organizations.id, organizationId));
	if (!organization) {
		throw new Error(`Organization ${organizationId} not found`);
	}

	const teamId = await defaultTeamId(tx, organization);
	const key = deriveTaskKey(organization.name);
	const [highest] = await tx
		.select({
			number: sql<
				number | null
			>`max(substring(${tasks.slug} from ${`^${key}-([0-9]{1,9})$`})::int)`,
		})
		.from(tasks)
		.where(
			and(
				eq(tasks.organizationId, organizationId),
				like(tasks.slug, `${key}-%`),
			),
		);

	await tx
		.insert(taskSequences)
		.values({ teamId, organizationId, key, lastNumber: highest?.number ?? 0 })
		.onConflictDoNothing();
}

/**
 * Takes `count` numbers from the organization's team. The sequence row stays
 * locked until the transaction commits, so creates in one team run one after
 * another.
 */
async function reserve(
	tx: DbWsTransaction,
	organizationId: string,
	count: number,
) {
	const sequence =
		(await advance(tx, organizationId, count)) ??
		(await createSequence(tx, organizationId).then(() =>
			advance(tx, organizationId, count),
		));
	if (!sequence) throw new Error(`No task sequence for ${organizationId}`);
	return sequence;
}

export interface TaskNumber {
	teamId: string;
	number: number;
	slug: string;
}

export async function reserveTaskNumber(
	tx: DbWsTransaction,
	organizationId: string,
): Promise<TaskNumber> {
	const { teamId, key, lastNumber } = await reserve(tx, organizationId, 1);
	return { teamId, number: lastNumber, slug: `${key}-${lastNumber}` };
}

export async function assignTaskNumbers<T>(
	tx: DbWsTransaction,
	organizationId: string,
	items: T[],
): Promise<Array<T & TaskNumber>> {
	if (items.length === 0) return [];
	const { teamId, key, lastNumber } = await reserve(
		tx,
		organizationId,
		items.length,
	);
	const first = lastNumber - items.length + 1;
	return items.map((item, index) => ({
		...item,
		teamId,
		number: first + index,
		slug: `${key}-${first + index}`,
	}));
}
