import { describe, expect, it } from "vitest";
import {
  daysForMonth,
  formatMonthDay,
  isValidMonthDay,
  monthDayFromIsoDate,
  monthDayValue,
  parseMonthDay,
} from "@/lib/people/birthDate";

describe("birth date helpers", () => {
  it("accepts real month/day values including February 29", () => {
    expect(isValidMonthDay(2, 29)).toBe(true);
    expect(parseMonthDay("02-29")).toEqual({ month: 2, day: 29 });
    expect(daysForMonth(2)).toBe(29);
  });

  it("rejects impossible month/day values", () => {
    expect(parseMonthDay("02-30")).toBeNull();
    expect(parseMonthDay("13-01")).toBeNull();
    expect(parseMonthDay("2-9")).toBeNull();
  });

  it("extracts and formats a birthday without inventing a year", () => {
    expect(monthDayFromIsoDate("1990-07-14")).toEqual({ month: 7, day: 14 });
    expect(monthDayValue(7, 14)).toBe("07-14");
    expect(formatMonthDay(7, 14)).toBe("July 14");
  });
});
