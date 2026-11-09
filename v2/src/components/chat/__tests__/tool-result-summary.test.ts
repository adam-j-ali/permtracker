import { describe, it, expect } from 'vitest';
import { summarizeToolResult } from '../tool-result-summary';

/**
 * The card under a tool call is the one place a person sees a tool's result,
 * so a limit has to show there as a limit: "No results found" over a spent
 * web-search quota, "340 cases found" over a list that stopped at 100, and
 * "Update failed" over a rate limit each hid what had happened.
 */
describe('summarizeToolResult and limits', () => {
  it('shows a spent web-search quota as that, not "No results found"', () => {
    const r = JSON.stringify({ error: 'Web search is used up for today.', reason: 'quota', resetsAtLocal: '8:00 PM EDT' });
    expect(summarizeToolResult('searchWeb', r)).toBe('Web search is used up for today. Back at 8:00 PM EDT.');
  });

  it('shows a web search that failed as failed', () => {
    const r = JSON.stringify({ error: "Web search didn't answer just now.", reason: 'failed' });
    expect(summarizeToolResult('searchWeb', r)).toBe("Web search didn't answer just now.");
  });

  it('shows a rate limit with its wait, for any tool', () => {
    const r = JSON.stringify({ error: 'Too many case changes in the last minute. Try again in 12 seconds.', reason: 'rate_limited', retryAfterSeconds: 12 });
    expect(summarizeToolResult('updateCase', r)).toBe('Too many case changes in the last minute. Try again in 12 seconds.');
    expect(summarizeToolResult('searchKnowledge', r)).toContain('Try again in 12 seconds');
  });

  it('shows "showing N of M" for a capped case list', () => {
    const r = JSON.stringify({ cases: [], count: 340, note: 'Showing 100 of 340 matching cases.' });
    expect(summarizeToolResult('queryCases', r)).toBe('Showing 100 of 340 matching cases.');
  });

  it('leaves ordinary results as they were', () => {
    expect(summarizeToolResult('queryCases', JSON.stringify({ cases: [{}, {}], count: 2 }))).toBe('2 cases found');
    expect(summarizeToolResult('searchWeb', JSON.stringify({ source: 'tavily', results: [] }))).toBe('No results found');
    expect(summarizeToolResult('updateCase', JSON.stringify({ error: 'Failed to update case' }))).toBe('Not saved');
  });

  it("says what a write did, from the server's read-back", () => {
    expect(summarizeToolResult('updateCase', JSON.stringify({ success: true, stage: 'ETA 9089, filed' }))).toBe('Saved, stage ETA 9089, filed');
    expect(summarizeToolResult('updateCase', JSON.stringify({ success: false, notSaved: ['Stage'] }))).toBe('Partly saved');
    expect(summarizeToolResult('updateCase', JSON.stringify({ needsInfo: true, message: 'Need the date' }))).toBe('Needs a detail first, so nothing changed');
    // A bulk close closes; it had read "Deleted".
    expect(summarizeToolResult('bulkArchiveCases', JSON.stringify({ successCount: 2 }))).toBe('Closed 2 cases');
  });
});

describe('summarizeToolResult reads the shapes the actions return', () => {
  it('counts the settings saved, and says which part did not save', () => {
    // Arrange: the settings action returns saved and notSaved lists
    const ok = JSON.stringify({ success: true, action: 'settings_updated', saved: ['Email alerts: on', 'Digest: weekly'], notSaved: [] });
    const part = JSON.stringify({ success: false, action: 'settings_updated', saved: ['Email alerts: on'], notSaved: ['Digest'] });
    // Act / Assert
    expect(summarizeToolResult('updateSettings', ok)).toBe('Updated 2 settings');
    expect(summarizeToolResult('updateSettings', part)).toBe('Some settings didn\'t save');
  });

  it('says calendar sync was turned on when it was', () => {
    // Arrange
    const on = JSON.stringify({ success: true, action: 'bulk_calendar_sync_enabled', successCount: 3, failedCount: 0 });
    const off = JSON.stringify({ success: true, action: 'bulk_calendar_sync_disabled', successCount: 1, failedCount: 0 });
    // Act / Assert
    expect(summarizeToolResult('bulkCalendarSync', on)).toBe('Synced 3 cases');
    expect(summarizeToolResult('bulkCalendarSync', off)).toBe('Unsynced 1 case');
  });

  it('shows a change already made as done, for any tool', () => {
    // Arrange: another tab made the change first
    const r = JSON.stringify({ alreadyDone: true, message: 'Deleted the notification already.' });
    // Act / Assert
    expect(summarizeToolResult('deleteNotification', r)).toBe('Deleted the notification already.');
    expect(summarizeToolResult('updateSettings', r)).toBe('Deleted the notification already.');
  });
});
