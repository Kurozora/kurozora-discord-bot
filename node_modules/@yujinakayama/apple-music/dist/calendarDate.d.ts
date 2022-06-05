export declare class CalendarDate {
    year: number;
    month: number;
    day: number;
    static parse(string: string): CalendarDate | undefined;
    constructor(year: number, month: number, day: number);
    toUTCDate(): Date;
}
//# sourceMappingURL=calendarDate.d.ts.map