import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_ID = "5d3f2a1e-0c7b-4a2d-9f11-6b8c0d4e7a52";
const WORKSPACE_ID = "ws-local";

interface Row {
	workspaceId: string;
	workspaceName: string | null;
	terminalId: string;
	agentId: string | null;
	sessionTitle: string | null;
	hostId: string;
	hostUrl: string;
}
type CloudWatch = { watching: boolean; agentId: string | null };

let rows: Row[] = [];
let bindings = new Map();
let assigned: unknown[] = [];
let assignError: Error | undefined;
let errors: string[] = [];
let configs: Array<{ id: string; label: string; presetId: string }> = [];
let launched: unknown[] = [];
let launchResult: { terminalId: string } | null = {
	terminalId: "new-terminal",
};
let bindingPolls = 0;
let bindingDelay = 0;
mock.module("renderer/assets/app-icons/preset-icons", () => ({
	usePresetIcon: () => null,
}));
mock.module("renderer/hooks/useV2AgentConfigs", () => ({
	useV2AgentConfigs: () => ({ data: configs }),
}));
const createNewAgentSession = async (input: unknown) => {
	launched.push(input);
	return launchResult;
};
mock.module("renderer/hooks/host-service/useTerminalAgentBindings", () => ({
	useTerminalAgentBindings: () => bindings,
}));
mock.module("renderer/hooks/host-service/useWorkspaceHostUrl", () => ({
	useWorkspaceHostUrl: () => "http://host-local",
}));
mock.module("@superset/ui/sonner", () => ({
	toast: { error: (message: string) => errors.push(message) },
}));
let cloudWatch: CloudWatch = { watching: false, agentId: null };
let navigated: Array<{ workspaceId: string; terminalId: string | undefined }> =
	[];
let unwatched: Array<{ hostUrl: string; pageId: string }> = [];

mock.module("renderer/hooks/host-service/usePageWatchersForPage", () => ({
	usePageWatchersForPage: () => rows,
}));
mock.module("renderer/lib/cloud-trpc", () => ({
	cloudTrpc: {
		page: {
			get: {
				useQuery: () => ({
					data: {
						id: PAGE_ID,
						slug: "my-page",
						title: "My page",
						watch: cloudWatch,
					},
				}),
			},
		},
		useUtils: () => ({
			page: { get: { invalidate: () => Promise.resolve() } },
		}),
	},
}));
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: (hostUrl: string) => ({
		terminalAgents: {
			listByWorkspace: {
				query: async () => {
					bindingPolls++;
					return bindingPolls <= bindingDelay
						? []
						: [{ terminalId: "new-terminal", agentId: "claude" }];
				},
			},
		},
		pageWatch: {
			assign: {
				mutate: (input: unknown) => {
					assigned.push({ hostUrl, input });
					return assignError
						? Promise.reject(assignError)
						: Promise.resolve([]);
				},
			},
			unwatch: {
				mutate: ({ pageId }: { pageId: string }) => {
					unwatched.push({ hostUrl, pageId });
					return Promise.resolve({ pageId });
				},
			},
		},
	}),
}));
mock.module("@tanstack/react-router", () => ({
	useNavigate: () => () => Promise.resolve(),
}));
mock.module(
	"renderer/routes/_authenticated/_dashboard/utils/workspace-navigation",
	() => ({
		navigateToV2Workspace: (
			workspaceId: string,
			_navigate: unknown,
			options?: { search?: { terminalId?: string } },
		) => {
			navigated.push({
				workspaceId,
				terminalId: options?.search?.terminalId,
			});
			return Promise.resolve();
		},
	}),
);
mock.module(
	"renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentIcon",
	() => ({ AgentIcon: () => null }),
);

const { act, cleanup, fireEvent, render, within } = await import(
	"@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { PageWatcherMenu } = await import("./PageWatcherMenu");

afterEach(async () => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		cleanup();
	});
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

beforeEach(() => {
	localStorage.clear();
	rows = [];
	configs = [];
	launched = [];
	launchResult = { terminalId: "new-terminal" };
	bindingPolls = 0;
	bindingDelay = 0;
	bindings = new Map();
	assigned = [];
	assignError = undefined;
	errors = [];
	cloudWatch = { watching: false, agentId: null };
	navigated = [];
	unwatched = [];
});

function watcher(overrides: Partial<Row> = {}): Row {
	return {
		workspaceId: "ws-a",
		workspaceName: "Chat UI",
		terminalId: "term-1",
		agentId: "codex",
		sessionTitle: "Page watcher redesign",
		hostId: "host-1",
		hostUrl: "http://host-1",
		...overrides,
	};
}

async function renderMenu(canManage = true) {
	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = render(
			<QueryClientProvider client={new QueryClient()}>
				<PageWatcherMenu
					workspaceId={WORKSPACE_ID}
					pageId={PAGE_ID}
					canManage={canManage}
					onCreateNewAgentSession={createNewAgentSession}
				/>
			</QueryClientProvider>,
		);
	});
	return within(view.baseElement as HTMLElement);
}

async function openMenu() {
	const ui = await renderMenu();
	await act(async () => {
		fireEvent.click(
			ui.getByRole("button", {
				name: "Agents watching this page for comments",
			}),
		);
	});
	return ui;
}

describe("a page nothing is watching", () => {
	test("always shows the agent control", async () => {
		const ui = await renderMenu();
		expect(ui.getByRole("button")).toBeDefined();
	});
});

describe("a page one agent is watching", () => {
	beforeEach(() => {
		rows = [watcher()];
		cloudWatch = { watching: true, agentId: "codex" };
	});

	test("names the session and the workspace it sits in", async () => {
		const ui = await openMenu();
		expect(ui.getByText("Page watcher redesign")).toBeDefined();
		expect(ui.getByText("Chat UI")).toBeDefined();
	});

	test("does not put the agent's name on the trigger", async () => {
		const ui = await renderMenu();
		expect(ui.getByRole("button").textContent).not.toContain("codex");
	});

	test("opens that agent's terminal in its own workspace", async () => {
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByText("Page watcher redesign"));
		});
		expect(navigated).toEqual([{ workspaceId: "ws-a", terminalId: "term-1" }]);
	});

	test("falls back to the agent's name when the session has no title", async () => {
		rows = [watcher({ sessionTitle: null })];
		const ui = await openMenu();
		expect(ui.getByText("codex")).toBeDefined();
	});

	test("the x stops it watching on its own host instead of opening it", async () => {
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Stop watching" }));
		});
		expect(unwatched).toEqual([{ hostUrl: "http://host-1", pageId: PAGE_ID }]);
		expect(navigated).toEqual([]);
	});

	test("keeps the x reachable when its workspace is not on this machine", async () => {
		rows = [watcher({ workspaceName: null })];
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Stop watching" }));
		});
		expect(unwatched).toEqual([{ hostUrl: "http://host-1", pageId: PAGE_ID }]);
	});
});

describe("a page several agents are watching", () => {
	beforeEach(() => {
		rows = [
			watcher(),
			watcher({
				workspaceId: "ws-b",
				workspaceName: "Onboarding flow",
				terminalId: "term-2",
				agentId: "claude",
				sessionTitle: "Onboarding copy pass",
				hostId: "host-2",
				hostUrl: "http://host-2",
			}),
		];
		cloudWatch = { watching: true, agentId: "codex" };
	});

	test("stops only the one whose x was clicked", async () => {
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(
				ui.getAllByRole("button", { name: "Stop watching" })[1] as HTMLElement,
			);
		});
		expect(unwatched).toEqual([{ hostUrl: "http://host-2", pageId: PAGE_ID }]);
	});

	test("counts them on the trigger", async () => {
		const ui = await renderMenu();
		expect(ui.getByRole("button").textContent).toContain("2");
	});

	test("lists every one of them", async () => {
		const ui = await openMenu();
		expect(ui.getByText("Page watcher redesign")).toBeDefined();
		expect(ui.getByText("Onboarding copy pass")).toBeDefined();
	});
});

describe("a watcher on a host this machine cannot reach", () => {
	beforeEach(() => {
		cloudWatch = { watching: true, agentId: "codex" };
	});

	test("still shows the badge, because comments do reach it", async () => {
		const ui = await renderMenu();
		expect(ui.getByRole("button")).toBeDefined();
	});

	test("says where it is instead of pretending nothing watches", async () => {
		const ui = await openMenu();
		expect(ui.getByText("On a host you can't reach")).toBeDefined();
		expect(ui.getByText("codex")).toBeDefined();
	});

	test("names it generically when the flag carries no agent", async () => {
		cloudWatch = { watching: true, agentId: null };
		const ui = await openMenu();
		expect(ui.getByText("An agent")).toBeDefined();
	});
});

describe("assigning an existing workspace agent", () => {
	beforeEach(() => {
		bindings.set("local-term", {
			terminalId: "local-term",
			agentId: "codex",
			lastEventAt: 1,
		});
	});

	test("lists an agent even when nothing watches the page and assigns it on the workspace host", async () => {
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
		});
		expect(assigned).toEqual([
			{
				hostUrl: "http://host-local",
				input: {
					pageId: PAGE_ID,
					slug: "my-page",
					title: "My page",
					workspaceId: WORKSPACE_ID,
					terminalId: "local-term",
					agentId: "codex",
				},
			},
		]);
	});

	test("surfaces assignment failures", async () => {
		assignError = new Error("Agent stopped");
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
		});
		expect(errors).toEqual(["Could not add agent"]);
	});

	test("does not offer an agent that already watches this page", async () => {
		rows = [
			watcher({ hostUrl: "http://host-local", terminalId: "local-term" }),
		];
		const ui = await openMenu();
		expect(ui.queryByText("codex")).toBeNull();
	});

	test("keeps the button visible for readers without offering assignment", async () => {
		const ui = await renderMenu(false);
		await act(async () => {
			fireEvent.click(
				ui.getByRole("button", {
					name: "Agents watching this page for comments",
				}),
			);
		});
		expect(ui.queryByText("Add agent")).toBeNull();
	});
});

describe("starting a page watcher", () => {
	beforeEach(() => {
		configs = [
			{ id: "claude-config", label: "Claude Code", presetId: "claude" },
		];
	});

	test("launches a configured agent when no agent exists, then assigns its actual binding", async () => {
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
		});
		expect(launched).toEqual([
			expect.objectContaining({
				configId: "claude-config",
				placement: "split-pane",
				prompt: expect.stringContaining(PAGE_ID),
			}),
		]);
		expect(assigned).toEqual([
			{
				hostUrl: "http://host-local",
				input: {
					pageId: PAGE_ID,
					slug: "my-page",
					title: "My page",
					workspaceId: WORKSPACE_ID,
					terminalId: "new-terminal",
					agentId: "claude",
				},
			},
		]);
	});

	test("waits for registration before assigning", async () => {
		bindingDelay = 1;
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
		});
		expect(assigned).toEqual([]);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 300));
		});
		expect(bindingPolls).toBe(2);
		expect(assigned).toHaveLength(1);
	});

	test("does not assign a watcher when launch fails", async () => {
		launchResult = null;
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
		});
		expect(assigned).toEqual([]);
		expect(bindingPolls).toBe(0);
	});

	test("reports an assignment failure after launch", async () => {
		assignError = new Error("Cannot watch");
		const ui = await openMenu();
		await act(async () => {
			fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
		});
		expect(errors).toEqual(["Could not add agent"]);
	});

	test("does not let page readers launch an agent", async () => {
		const ui = await renderMenu(false);
		await act(async () => {
			fireEvent.click(
				ui.getByRole("button", {
					name: "Agents watching this page for comments",
				}),
			);
		});
		expect(ui.queryByText("Start new session")).toBeNull();
	});
});

test("uses the Settings placement for a new session", async () => {
	configs = [{ id: "claude-config", label: "Claude Code", presetId: "claude" }];
	const ui = await openMenu();
	await act(async () => {
		const { setAgentSessionPlacement } = await import(
			"renderer/hooks/useAgentSessionPlacement"
		);
		setAgentSessionPlacement("new-tab");
	});
	await act(async () => {
		fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
	});
	expect(ui.queryByRole("radio")).toBeNull();
	expect(launched).toEqual([expect.objectContaining({ placement: "new-tab" })]);
});

test("filters agent choices and selects without launching", async () => {
	configs = [
		{ id: "claude-config", label: "Claude Code", presetId: "claude" },
		{ id: "codex-config", label: "Codex", presetId: "codex" },
	];
	const ui = await openMenu();
	await act(async () => {
		fireEvent.click(ui.getByRole("button", { name: "Choose agent" }));
	});
	const input = ui.getByRole("combobox", { name: "Choose agent" });
	await act(async () => {
		fireEvent.change(input, { target: { value: "Codex" } });
	});
	expect(ui.queryByRole("option", { name: "Claude Code" })).toBeNull();
	await act(async () => {
		fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
	});
	expect(ui.queryByRole("combobox")).toBeNull();
	expect(
		ui.getByRole("button", { name: "Choose agent" }).textContent,
	).toContain("Codex");
	expect(launched).toHaveLength(0);
	await act(async () => {
		fireEvent.click(ui.getByRole("button", { name: "Add agent" }));
	});
	expect(launched).toEqual([
		expect.objectContaining({ configId: "codex-config" }),
	]);
});
