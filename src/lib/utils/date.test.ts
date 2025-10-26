/**
 * Date utilities tests
 */

import { describe, it, expect } from 'vitest';
import { formatDistanceToNow, formatMessageTime } from './date';

describe('Date Utilities', () => {
  describe('formatDistanceToNow', () => {
    it('should format recent time as "just now"', () => {
      const now = Date.now();
      expect(formatDistanceToNow(now)).toBe('just now');
      expect(formatDistanceToNow(now - 30000)).toBe('just now');
    });

    it('should format minutes', () => {
      const oneMinuteAgo = Date.now() - 60 * 1000;
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      expect(formatDistanceToNow(oneMinuteAgo)).toBe('1m');
      expect(formatDistanceToNow(fiveMinutesAgo)).toBe('5m');
    });

    it('should format hours', () => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
      expect(formatDistanceToNow(oneHourAgo)).toBe('1h');
      expect(formatDistanceToNow(threeHoursAgo)).toBe('3h');
    });

    it('should format days', () => {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      expect(formatDistanceToNow(oneDayAgo)).toBe('1d');
      expect(formatDistanceToNow(threeDaysAgo)).toBe('3d');
    });

    it('should format weeks', () => {
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      expect(formatDistanceToNow(oneWeekAgo)).toBe('1w');
      expect(formatDistanceToNow(twoWeeksAgo)).toBe('2w');
    });

    it('should format months', () => {
      const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      expect(formatDistanceToNow(oneMonthAgo)).toBe('1mo');
    });

    it('should format years', () => {
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      expect(formatDistanceToNow(oneYearAgo)).toBe('1y');
    });
  });

  describe('formatMessageTime', () => {
    it('should format today\'s messages with time', () => {
      const now = Date.now();
      const result = formatMessageTime(now);
      expect(result).toMatch(/\d{1,2}:\d{2}\s(AM|PM)/);
    });

    it('should format yesterday as "Yesterday"', () => {
      const yesterday = Date.now() - 24 * 60 * 60 * 1000;
      const result = formatMessageTime(yesterday);
      expect(result).toBe('Yesterday');
    });

    it('should format this year with month and day', () => {
      const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const result = formatMessageTime(threeMonthsAgo);
      expect(result).toMatch(/[A-Z][a-z]{2}\s\d{1,2}/);
    });

    it('should format old dates with year', () => {
      const lastYear = new Date();
      lastYear.setFullYear(lastYear.getFullYear() - 1);
      const result = formatMessageTime(lastYear.getTime());
      expect(result).toMatch(/[A-Z][a-z]{2}\s\d{1,2},\s\d{4}/);
    });
  });
});

