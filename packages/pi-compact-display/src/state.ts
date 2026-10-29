export class SummaryTracker {
	private seenIds = new Set<string>();
	private toolCounts = new Map<string, number>();
	private hasGroupedTools = false;
	private hasToolErrors = false;

	reset(): void {
		this.seenIds.clear();
		this.toolCounts.clear();
		this.hasGroupedTools = false;
		this.hasToolErrors = false;
	}

	countCall(id: string, toolName: string): void {
		if (this.seenIds.has(id)) return;
		this.seenIds.add(id);
		this.toolCounts.set(toolName, (this.toolCounts.get(toolName) || 0) + 1);
		this.hasGroupedTools = true;
	}

	getSummaryLine(): string {
		const parts = [...this.toolCounts.entries()].map(([n, c]) => `${n}(${c})`);
		return `⚡ ${parts.join(" ")}`;
	}

	hasGrouped(): boolean {
		return this.hasGroupedTools;
	}

	hasErrors(): boolean {
		return this.hasToolErrors;
	}

	setError(): void {
		this.hasToolErrors = true;
	}

	// For testing purposes
	getCounts(): Map<string, number> {
		return new Map(this.toolCounts);
	}
}
