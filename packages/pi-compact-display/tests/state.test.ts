import { describe, it, expect } from 'vitest';
import { SummaryTracker } from '../src/state.ts';

describe('SummaryTracker', () => {
	it('should initialize with empty states', () => {
		const tracker = new SummaryTracker();
		expect(tracker.hasGrouped()).toBe(false);
		expect(tracker.hasErrors()).toBe(false);
		expect(tracker.getSummaryLine()).toBe('⚡ ');
	});

	it('should count calls uniquely by id', () => {
		const tracker = new SummaryTracker();
		tracker.countCall('1', 'read');
		tracker.countCall('1', 'read'); // duplicate id
		tracker.countCall('2', 'read');
		tracker.countCall('3', 'write');

		expect(tracker.hasGrouped()).toBe(true);
		expect(tracker.getCounts().get('read')).toBe(2);
		expect(tracker.getCounts().get('write')).toBe(1);
		expect(tracker.getSummaryLine()).toBe('⚡ read(2) write(1)');
	});

	it('should set and reset errors and state correctly', () => {
		const tracker = new SummaryTracker();
		tracker.countCall('1', 'read');
		tracker.setError();

		expect(tracker.hasGrouped()).toBe(true);
		expect(tracker.hasErrors()).toBe(true);

		tracker.reset();

		expect(tracker.hasGrouped()).toBe(false);
		expect(tracker.hasErrors()).toBe(false);
		expect(tracker.getSummaryLine()).toBe('⚡ ');
		expect(tracker.getCounts().size).toBe(0);
	});
});
